import { parseCode } from './parser.mjs';
import { VariableState } from './variableState.mjs';
import {
    STATUS_SUCCESS,
    STATUS_FAIL,
    STATUS_UNDEFINED,
    STATUS_CANCELED,
} from './constants.mjs';
import {
    createUndefinedValue,
    createFailValue,
    createSuccessValue,
    valueToCommandArgument,
    formatPublicValue,
    createPropagatedCanceledValue,
    cloneValueWith,
} from './valueHelpers.mjs';
import { getInternalCommands } from './internalCommands.mjs';
import {
    DefaultExecutionMonitor,
    ensureExecutionMonitor,
} from './executionMonitor.mjs';
import { cancelEuristic } from './cancelHeuristic.mjs';
import { createCommandResponder } from './responseBuilder.mjs';
import { FINAL_ANSWER_TOOL, CANNOT_COMPLETE_TOOL } from '../LLMAgents/constants.mjs';

const DEBUG_ENABLED = String(process.env.ACHILLES_DEBUG ?? '').toLowerCase() === 'true';

function ensureCommandsRegistry(commandsRegistry) {
    if (!commandsRegistry || typeof commandsRegistry !== 'object') {
        throw new Error('commandsRegistry must be an object');
    }
    const { executeCommand, listCommands } = commandsRegistry;
    if (typeof executeCommand !== 'function') {
        throw new Error('commandsRegistry.executeCommand must be a function');
    }
    if (typeof listCommands !== 'function') {
        throw new Error('commandsRegistry.listCommands must be a function');
    }
    return commandsRegistry;
}

function buildCommandNames(entries) {
    if (!Array.isArray(entries)) return new Set();
    const names = entries
        .map((entry) => entry?.name || entry?.command)
        .filter((name) => typeof name === 'string' && name.trim());
    return new Set(names);
}

function ensureOnFail(onFail) {
    if (typeof onFail === 'function') {
        return onFail;
    }
    return () => { };
}

function extractOptions(onFailOrOptions, maybeOptions) {
    if (typeof onFailOrOptions === 'function') {
        return {
            onFail: onFailOrOptions,
            options: typeof maybeOptions === 'object' && maybeOptions ? maybeOptions : {},
        };
    }
    if (typeof onFailOrOptions === 'object' && onFailOrOptions) {
        return {
            onFail: typeof onFailOrOptions.onFail === 'function' ? onFailOrOptions.onFail : undefined,
            options: onFailOrOptions,
        };
    }
    return {
        onFail: undefined,
        options: {},
    };
}

function normalizeConstructorArgs(args) {
    const result = {
        inputValue: undefined,
        onFailOrOptions: undefined,
        maybeOptions: undefined,
    };

    if (!args.length) {
        return result;
    }

    const [first, second, third] = args;
    const isOptionsCandidate = (value) => {
        if (typeof value === 'function') {
            return true;
        }
        if (typeof value === 'object' && value) {
            const knownKeys = [
                'onFail',
                'executionMonitor',
                'llmAgent',
                'maxLlmaRounds',
                'cancelHeuristic',
                'autoCancel',
                'options',
            ];
            return knownKeys.some((key) => Object.prototype.hasOwnProperty.call(value, key));
        }
        return false;
    };

    if (!isOptionsCandidate(first)) {
        result.inputValue = first;
        result.onFailOrOptions = second;
        result.maybeOptions = third;
    } else {
        result.onFailOrOptions = first;
        result.maybeOptions = second;
    }

    return result;
}

export class LightSOPLangInterpreter {
    constructor(code, commandsRegistry, ...rest) {
        const { inputValue, onFailOrOptions, maybeOptions } = normalizeConstructorArgs(rest);
        const { onFail, options } = extractOptions(onFailOrOptions ?? {}, maybeOptions);
        this._externalRegistry = ensureCommandsRegistry(commandsRegistry);
        this._internalCommands = getInternalCommands();
        this._externalCommandNames = null;
        this.commandsRegistry = this._createMergedRegistry(this._externalRegistry);
        this.onFail = ensureOnFail(onFail ?? options.onFail);
        this.llmAgent = options.llmAgent ?? null;
        this.llmModel = typeof options.llmModel === 'string'
            ? options.llmModel
            : (typeof options.model === 'string' ? options.model : null);
        this.llmTags = Array.isArray(options.llmTags) ? options.llmTags : (Array.isArray(options.tags) ? options.tags : null);
        this.llmSignal = options.llmSignal ?? options.signal ?? null;
        this.llmReasoningEffort = typeof options.reasoningEffort === 'string' ? options.reasoningEffort : null;
        this.maxLlmaRounds = Number.isFinite(options.maxLlmaRounds) ? options.maxLlmaRounds : 5;
        this.executionMonitor = ensureExecutionMonitor(options.executionMonitor ?? new DefaultExecutionMonitor());
        const registryHeuristic = typeof this.commandsRegistry.cancelHeuristic === 'function'
            ? this.commandsRegistry.cancelHeuristic
            : null;
        this.cancelHeuristic = typeof options.cancelHeuristic === 'function'
            ? options.cancelHeuristic
            : registryHeuristic ?? cancelEuristic;
        const registryAutoCancel = typeof this.commandsRegistry.autoCancel === 'boolean'
            ? this.commandsRegistry.autoCancel
            : false;
        this.autoCancelEnabled = Boolean(options.autoCancel ?? registryAutoCancel);
        this.onPlanGenerated = typeof options.onPlanGenerated === 'function' ? options.onPlanGenerated : null;
        this.generateOnly = Boolean(options.generateOnly ?? false);

        const explicitInput = inputValue !== undefined ? inputValue : (options.input ?? undefined);
        this.inputValue = explicitInput;

        this.variables = new Map();
        this._runQueue = Promise.resolve();
        this._updateChain = Promise.resolve();
        this.ready = Promise.resolve();

        this.currentSourceCode = '';
        this.englishContext = null;

        if (code) {
            this.updateCode(code);
        }
    }

    _createMergedRegistry(externalRegistry) {
        const getExternalNames = () => {
            if (!this._externalCommandNames) {
                let raw = [];
                try {
                    raw = externalRegistry.listCommands() || [];
                } catch {
                    raw = [];
                }
                this._externalCommandNames = buildCommandNames(raw);
            }
            return this._externalCommandNames;
        };

        return {
            executeCommand: async (payload, responder) => {
                const commandName = payload?.command;
                if (commandName && Object.prototype.hasOwnProperty.call(this._internalCommands, commandName)) {
                    const names = getExternalNames();
                    if (!names.has(commandName)) {
                        return this._internalCommands[commandName](payload, responder);
                    }
                }
                return externalRegistry.executeCommand(payload, responder);
            },
            listCommands: () => externalRegistry.listCommands(),
            cancelHeuristic: externalRegistry.cancelHeuristic,
            autoCancel: externalRegistry.autoCancel,
        };
    }

    updateCode(rawCode, metadata = {}) {
        const queueTask = async () => {
            const preparedCode = await this._prepareCode(rawCode, metadata);
            this._applyPreparedCode(preparedCode);
            return this._scheduleRun();
        };

        this._updateChain = this._updateChain.then(queueTask, queueTask);
        this.ready = this._updateChain;
        return this.ready;
    }

    getVarValue(variableName) {
        const variable = this.variables.get(variableName);
        if (!variable) {
            return undefined;
        }
        return formatPublicValue(variable.value);
    }

    enableAutoCancel(flag = true, heuristic = null) {
        this.autoCancelEnabled = Boolean(flag);
        if (typeof heuristic === 'function') {
            this.cancelHeuristic = heuristic;
        }
    }

    async _prepareCode(rawCode, metadata = {}) {
        const normalized = typeof rawCode === 'string' ? rawCode : '';
        if (metadata.preserveEnglish) {
            return normalized;
        }

        const trimmedStart = normalized.trimStart();
        if (trimmedStart.startsWith('#!english')) {
            if (!this.llmAgent) {
                throw new Error('LLMAgent is required to process #!english scripts');
            }
            const lines = normalized.split(/\r?\n/);
            const instructions = lines.slice(1).join('\n').trim();
            this.englishContext = {
                instructions,
                attempt: 0,
                history: [],
                lastCode: null,
            };
            const generated = await this._requestLlmaCode('initial', {
                failures: [],
                variables: [],
                previousCode: null,
            });
            if (this.onPlanGenerated) {
                this.onPlanGenerated({
                    code: generated,
                    previousCode: null,
                    reason: 'initial',
                    attempt: 0,
                });
            }
            if (this.generateOnly) {
                // For generate-only mode, store the code and resolve immediately
                this.currentSourceCode = generated;
                this.englishContext.lastCode = generated;
                return generated;
            }
            return generated;
        }

        this.englishContext = null;
        return normalized;
    }

    _applyPreparedCode(code) {
        if (this.generateOnly) {
            // In generate-only mode, just store the code without parsing/executing
            this.currentSourceCode = code;
            if (this.englishContext) {
                this.englishContext.lastCode = code;
            }
            return;
        }
        const declarations = parseCode(code);
        this.currentSourceCode = code;
        if (this.englishContext) {
            this.englishContext.lastCode = code;
        }
 
        const seenNames = new Set();
        const changedVariables = [];
        let finalDeclarations = 0;
 
        for (const [name, declaration] of declarations) {
            if (declaration.command === FINAL_ANSWER_TOOL || declaration.command === CANNOT_COMPLETE_TOOL) {
                finalDeclarations += 1;
            }
            let variable = this.variables.get(name);
            if (!variable) {
                variable = new VariableState(name);
                this.variables.set(name, variable);
            }
            const signatureChanged = variable.signature !== declaration.signature;
            variable.updateFromDeclaration(declaration);
            const needsReset = declaration.command === FINAL_ANSWER_TOOL
                || declaration.command === CANNOT_COMPLETE_TOOL
                || name === 'lastAnswer';
            if (signatureChanged || needsReset) {
                changedVariables.push(variable);
            }
            seenNames.add(name);
        }

        if (this.englishContext && finalDeclarations === 0 && this._supportsFinalAnswer()) {
            throw new Error(`LightSOPLang plans generated from #!english must include at least one "${FINAL_ANSWER_TOOL}" or "${CANNOT_COMPLETE_TOOL}" declaration (for example "@lastAnswer ${FINAL_ANSWER_TOOL} <final text>").`);
        }


        for (const name of Array.from(this.variables.keys())) {
            if (name === 'input' && this.inputValue !== undefined && !seenNames.has('input')) {
                continue;
            }
            if (!seenNames.has(name)) {
                this.variables.delete(name);
            }
        }

        this._ensureInputVariable(seenNames);

        for (const variable of this.variables.values()) {
            variable.dependents = new Set();
        }

        for (const variable of this.variables.values()) {
            for (const dependencyName of variable.dependencies) {
                const dependency = this.variables.get(dependencyName);
                if (!dependency) {
                    throw new Error(`Variable ${variable.name} depends on undefined variable ${dependencyName}`);
                }
                dependency.dependents.add(variable.name);
            }
        }

        for (const variable of changedVariables) {
            variable.markChanged();
        }

        this._ensureInputVariable();
    }

    _ensureInputVariable(seenNames = new Set()) {
        if (this.inputValue === undefined) {
            return;
        }

        if (seenNames.has('input')) {
            return;
        }

        let variable = this.variables.get('input');
        if (!variable) {
            variable = new VariableState('input');
            this.variables.set('input', variable);
        }
        if (variable.value.status !== STATUS_SUCCESS || variable.value.data !== this.inputValue) {
            variable.value = createSuccessValue(this.inputValue, 'input');
        }
    }

    _scheduleRun() {
        const runPromise = this._runQueue.then(() => this._run());
        this._runQueue = runPromise.catch(() => { });
        this.ready = runPromise;
        return runPromise;
    }

    async _run() {
        if (!this.variables.size) {
            return;
        }

        this._propagateInvalidations();
        const levels = this._computeTopologicalLevels();

        for (const level of levels) {
            const pendingExecutions = [];
            for (const variableName of level) {
                const variable = this.variables.get(variableName);
                if (!variable) {
                    continue;
                }
                if (variable.value.status !== STATUS_UNDEFINED) {
                    continue;
                }
                if (!this._dependenciesSatisfied(variable)) {
                    continue;
                }
                pendingExecutions.push(this._executeVariable(variable));
            }
            if (pendingExecutions.length) {
                await Promise.all(pendingExecutions);
            }
        }

        const retried = await this._notifyFailures();
        if (retried) {
            return;
        }
    }

    async _notifyFailures() {
        const failed = Array.from(this.variables.values())
            .filter(variable => variable.value.status === STATUS_FAIL);

        const canceled = this.englishContext
            ? Array.from(this.variables.values()).filter(variable => (
                variable.value.status === STATUS_CANCELED
            ))
            : [];

        const issues = this.englishContext
            ? failed.concat(canceled)
            : failed;

        if (issues.length && this.englishContext && this.llmAgent) {
            const fixTriggered = await this._attemptLlmaFix(issues);
            if (fixTriggered) {
                return true;
            }
        }

        if (!failed.length) {
            return false;
        }

        const failureDetails = failed.map(variable => ({
            variable: variable.name,
            reason: formatPublicValue(variable.value),
        }));

        try {
            this.onFail(failureDetails);
        } catch (error) {
            if (DEBUG_ENABLED) {
                console.error('onFail handler threw an error:', error);
            }
        }

        return false;
    }

    async _attemptLlmaFix(failedVariables) {
        if (!this.englishContext || !this.llmAgent) {
            return false;
        }
        if (this.englishContext.attempt >= this.maxLlmaRounds) {
            return false;
        }

        const snapshot = this._snapshotVariables();
        let newCode;
        try {
            newCode = await this._requestLlmaCode('failure', {
                failures: failedVariables.map(entry => ({
                    variable: entry.name,
                    reason: formatPublicValue(entry.value),
                })),
                variables: snapshot,
                previousCode: this.currentSourceCode,
            });
        } catch (error) {
            return false;
        }

        if (!newCode) {
            return false;
        }

        if (this.onPlanGenerated) {
            this.onPlanGenerated({
                code: newCode,
                previousCode: this.currentSourceCode,
                reason,
                attempt: this.englishContext.attempt,
            });
        }
        this.updateCode(newCode, { preserveEnglish: true });
        return true;
    }

    _snapshotVariables() {
        return Array.from(this.variables.values()).map(variable => ({
            name: variable.name,
            status: variable.value.status,
            value: formatPublicValue(variable.value),
            raw: variable.value.raw,
        }));
    }

    _listCommands() {
        let entries = [];
        try {
            const raw = this.commandsRegistry.listCommands();
            if (Array.isArray(raw)) {
                entries = raw;
            }
        } catch (error) {
            entries = [];
        }
        return entries
            .map((entry) => {
                if (!entry || typeof entry !== 'object') {
                    return { name: String(entry ?? ''), description: '' };
                }
                const name = entry.name ?? entry.command ?? '';
                return {
                    name: String(name),
                    description: typeof entry.description === 'string' ? entry.description : '',
                };
            })
            .filter(entry => entry.name.length);
    }

    _supportsFinalAnswer() {
        const commands = this._listCommands();
        return commands.some((entry) => entry.name === FINAL_ANSWER_TOOL || entry.name === CANNOT_COMPLETE_TOOL);
    }

    _buildLlmaPrompt(context) {
        const lines = [];
        const commandEntries = Array.isArray(context.commands) ? context.commands : [];
        const supportsFinalAnswer = commandEntries.some((entry) => (
            entry?.name === FINAL_ANSWER_TOOL || entry?.name === CANNOT_COMPLETE_TOOL
        ));

        lines.push('Emit LightSOPLang code. Format: @varName command arg1 arg2');
        lines.push('Args on the declaration line are space-separated, NO parentheses/commas. Quote strings with spaces. Use $var to reference previous results.');
        lines.push('For long text, put it on the following lines; all lines until the next @ declaration become one clean multiline literal argument.');
        lines.push('Before user-visible tool steps, add a short # progress comment immediately above the declaration.');
        lines.push('Example: @sum add 5 3');
        lines.push('@upper uppercase "hello world"');
        lines.push('@combined concat $sum $upper');
        if (supportsFinalAnswer) {
            lines.push(`@lastAnswer ${FINAL_ANSWER_TOOL} $combined`);
        }
        lines.push('');
        lines.push('Rules: Use ONLY commands listed in the Commands section below, plus assign for local text variables. No interpolation in strings (use separate args). No markdown fences.');
        lines.push('The Commands section is the only executable tool surface. Do not use command, skill, or orchestrator names from the instructions or input context unless they appear in Commands.');
        if (supportsFinalAnswer) {
            lines.push(`If answerable without commands: @lastAnswer ${FINAL_ANSWER_TOOL} "your answer"`);
            lines.push(`Always end with @lastAnswer ${FINAL_ANSWER_TOOL} or ${CANNOT_COMPLETE_TOOL}.`);
        }
        lines.push('');
        if (context.reason === 'initial') {
            lines.push('Generate an initial script that meets the instructions.');
        } else {
            lines.push(`Attempt ${context.attempt}: revise the script to address reported issues.`);
        }
        if (context.instructions) {
            lines.push('Instructions:');
            lines.push(context.instructions.trim());
        }
        if (this.inputValue !== undefined) {
            lines.push('Input context:');
            lines.push(typeof this.inputValue === 'string' ? this.inputValue : JSON.stringify(this.inputValue));
        }
        if (context.commands && context.commands.length) {
            lines.push('Commands:');
            for (const command of context.commands) {
                lines.push(`- ${command.name}: ${command.description}`);
            }
        }
        if (context.previousCode) {
            lines.push('Previous code:');
            lines.push(context.previousCode);
        }
        if (context.failures && context.failures.length) {
            lines.push('Failures:');
            for (const failure of context.failures) {
                lines.push(`- ${failure.variable}: ${failure.reason}`);
            }
        }
        if (context.variables && context.variables.length) {
            lines.push('Variable snapshot:');
            for (const variable of context.variables) {
                lines.push(`- ${variable.name}: ${variable.status} => ${variable.value}`);
            }
        }
        lines.push('Output ONLY LightSOPLang code, no fences or explanations.');
        return lines.join('\n');
    }

    _dependenciesSatisfied(variable) {
        for (const dependencyName of variable.dependencies) {
            const dependency = this.variables.get(dependencyName);
            if (!dependency) {
                throw new Error(`Missing dependency ${dependencyName}`);
            }
            if (dependency.value.status !== STATUS_SUCCESS) {
                return false;
            }
        }
        return true;
    }

    _propagateInvalidations() {
        const undefinedSeeds = [];
        const canceledSeeds = [];

        for (const variable of this.variables.values()) {
            const previousValue = variable.value;

            const canceledDependency = this._findCanceledDependency(variable);
            if (canceledDependency) {
                const rootCause = canceledDependency.value.rootCause ?? {
                    name: canceledDependency.name,
                    reason: canceledDependency.value.data,
                };
                const newValue = createPropagatedCanceledValue(rootCause, canceledDependency.name);
                const shouldUpdate = previousValue.status !== STATUS_CANCELED
                    || previousValue.rootCause?.name !== newValue.rootCause?.name
                    || previousValue.data !== newValue.data
                    || previousValue.timestamp < newValue.timestamp;
                if (shouldUpdate) {
                    variable.value = newValue;
                    canceledSeeds.push(variable.name);
                }
                continue;
            }

            if (previousValue.status === STATUS_CANCELED) {
                variable.value = createUndefinedValue('cancellation cleared', 'recovery');
                undefinedSeeds.push(variable.name);
                continue;
            }

            let shouldInvalidate = false;
            let reason = '';
            let latestDependencyTimestamp = Number.NEGATIVE_INFINITY;

            for (const dependencyName of variable.dependencies) {
                const dependency = this.variables.get(dependencyName);
                if (!dependency) {
                    throw new Error(`Missing dependency ${dependencyName}`);
                }
                const { status, timestamp } = dependency.value;
                if (status === STATUS_UNDEFINED) {
                    shouldInvalidate = true;
                    reason = `waiting for ${dependencyName}`;
                    break;
                }
                if (status === STATUS_FAIL) {
                    shouldInvalidate = true;
                    reason = `dependency failure ${dependencyName}`;
                    break;
                }
                if (status === STATUS_SUCCESS && Number.isFinite(timestamp) && timestamp > latestDependencyTimestamp) {
                    latestDependencyTimestamp = timestamp;
                }
            }

            if (!shouldInvalidate && Number.isFinite(latestDependencyTimestamp)) {
                const currentTimestamp = previousValue.timestamp ?? Number.NaN;
                if (!Number.isFinite(currentTimestamp) || latestDependencyTimestamp > currentTimestamp) {
                    shouldInvalidate = true;
                    reason = 'stale dependency';
                }
            }

            if (shouldInvalidate) {
                if (previousValue.status !== STATUS_UNDEFINED || previousValue.data !== reason) {
                    variable.value = createUndefinedValue(reason, 'dependency');
                    undefinedSeeds.push(variable.name);
                }
            }
        }

        if (undefinedSeeds.length) {
            this._propagateUndefined(undefinedSeeds);
        }
        if (canceledSeeds.length) {
            this._propagateCanceled(canceledSeeds);
        }
    }

    _findCanceledDependency(variable) {
        for (const dependencyName of variable.dependencies) {
            const dependency = this.variables.get(dependencyName);
            if (!dependency) {
                continue;
            }
            if (dependency.value.status === STATUS_CANCELED) {
                return { name: dependencyName, value: dependency.value };
            }
        }
        return null;
    }

    async _executeVariable(variable) {
        const tokens = [variable.command];
        const argumentValues = [];
        for (const argument of variable.arguments) {
            if (argument.type === 'literal') {
                tokens.push(argument.value);
                argumentValues.push(argument.value);
                continue;
            }
            const dependency = this.variables.get(argument.name);
            if (!dependency) {
                throw new Error(`Missing dependency ${argument.name}`);
            }
            const value = valueToCommandArgument(dependency.value);
            tokens.push(value);
            argumentValues.push(value);
        }

        const input = tokens.join(' ');
        let resultValue;
        const responder = createCommandResponder(variable.name, {
            commandName: variable.command,
            autoCancel: this.autoCancelEnabled,
            heuristic: this.cancelHeuristic,
        });

        const payload = {
            command: variable.command,
            args: argumentValues,
            raw: input,
            variable: variable.name,
            variableState: variable,
            lineNumber: variable.lineNumber,
            comment: variable.comment,
            commentLines: Array.isArray(variable.commentLines) ? variable.commentLines.slice() : [],
        };

        this.executionMonitor.beforeExecuteCommand(variable.command, input);

        try {
            const executionResult = await this.commandsRegistry.executeCommand(payload, responder.api);
            resultValue = executionResult ?? responder.getLastValue();
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            variable.value = createFailValue(message, 'exception');
            this.executionMonitor.reportCommandFailure(variable.command, message);
            this._propagateUndefined([variable.name]);
            return;
        }

        if (!resultValue) {
            variable.value = createUndefinedValue('command returned no response', 'command');
            this._propagateUndefined([variable.name]);
            return;
        }

        if (!resultValue.raw || !resultValue.status) {
            variable.value = createFailValue('invalid result from executeCommand', 'validation');
            this.executionMonitor.reportCommandFailure(variable.command, 'invalid result from executeCommand');
            this._propagateUndefined([variable.name]);
            return;
        }

        if (resultValue.status === STATUS_CANCELED && !resultValue.rootCause) {
            resultValue = cloneValueWith(resultValue, {
                rootCause: {
                    name: variable.name,
                    reason: resultValue.data,
                },
            });
        }

        if (resultValue.status === STATUS_FAIL && !resultValue.data) {
            resultValue = cloneValueWith(resultValue, { data: 'unknown failure' });
        }

        const previousValue = variable.value;
        variable.value = resultValue;

        if (resultValue.status === STATUS_UNDEFINED || resultValue.status === STATUS_FAIL) {
            if (resultValue.status === STATUS_FAIL) {
                this.executionMonitor.reportCommandFailure(variable.command, resultValue.data);
            }
            this._propagateUndefined([variable.name]);
            return;
        }

        if (resultValue.status === STATUS_CANCELED) {
            this._propagateCanceled([variable.name]);
            return;
        }

        if (resultValue.status === STATUS_SUCCESS) {
            const prevTimestamp = previousValue?.timestamp ?? Number.NaN;
            const timestampIncreased = Number.isFinite(resultValue.timestamp)
                && (!Number.isFinite(prevTimestamp) || resultValue.timestamp > prevTimestamp);
            const valueChanged = previousValue?.data !== resultValue.data;
            if (timestampIncreased || valueChanged) {
                this._propagateUndefined(variable.dependents);
            }
        }
    }

    _propagateUndefined(seedNames) {
        const queue = [];
        if (seedNames == null) {
            return;
        }
        if (typeof seedNames !== 'string' && typeof seedNames[Symbol.iterator] === 'function') {
            for (const name of seedNames) {
                if (name != null) {
                    queue.push(name);
                }
            }
        } else {
            queue.push(seedNames);
        }
        const visited = new Set(queue);

        while (queue.length) {
            const name = queue.shift();
            const variable = this.variables.get(name);
            if (!variable) {
                continue;
            }
            for (const dependentName of variable.dependents) {
                const dependent = this.variables.get(dependentName);
                if (!dependent) {
                    continue;
                }
                if (dependent.value.status !== STATUS_UNDEFINED) {
                    dependent.value = createUndefinedValue(`upstream ${name}`, 'propagation');
                }
                if (!visited.has(dependentName)) {
                    visited.add(dependentName);
                    queue.push(dependentName);
                }
            }
        }
    }

    _propagateCanceled(seedNames) {
        const queue = [];
        if (seedNames == null) {
            return;
        }
        if (typeof seedNames !== 'string' && typeof seedNames[Symbol.iterator] === 'function') {
            for (const name of seedNames) {
                if (name != null) {
                    queue.push(name);
                }
            }
        } else {
            queue.push(seedNames);
        }
        const visited = new Set(queue);

        while (queue.length) {
            const name = queue.shift();
            const variable = this.variables.get(name);
            if (!variable) {
                continue;
            }
            const rootCause = variable.value.rootCause ?? {
                name: variable.name,
                reason: variable.value.data,
            };
            for (const dependentName of variable.dependents) {
                const dependent = this.variables.get(dependentName);
                if (!dependent) {
                    continue;
                }
                const newValue = createPropagatedCanceledValue(rootCause, name);
                const currentValue = dependent.value;
                const shouldUpdate = currentValue.status !== STATUS_CANCELED
                    || currentValue.rootCause?.name !== newValue.rootCause?.name
                    || currentValue.data !== newValue.data
                    || currentValue.timestamp < newValue.timestamp;
                if (shouldUpdate) {
                    dependent.value = newValue;
                }
                if (!visited.has(dependentName)) {
                    visited.add(dependentName);
                    queue.push(dependentName);
                }
            }
        }
    }

    _computeTopologicalLevels() {
        const inDegree = new Map();
        for (const variable of this.variables.values()) {
            inDegree.set(variable.name, variable.dependencies.size);
        }

        let currentLevel = Array.from(inDegree.entries())
            .filter(([, degree]) => degree === 0)
            .map(([name]) => name)
            .sort();

        const levels = [];
        let processed = 0;

        while (currentLevel.length) {
            levels.push(currentLevel);
            const nextLevel = [];
            for (const variableName of currentLevel) {
                processed += 1;
                const variable = this.variables.get(variableName);
                if (!variable) {
                    continue;
                }
                for (const dependentName of variable.dependents) {
                    const currentDegree = inDegree.get(dependentName);
                    if (typeof currentDegree !== 'number') {
                        continue;
                    }
                    const updatedDegree = currentDegree - 1;
                    inDegree.set(dependentName, updatedDegree);
                    if (updatedDegree === 0) {
                        nextLevel.push(dependentName);
                    }
                }
            }
            currentLevel = nextLevel.sort();
        }

        if (processed !== this.variables.size) {
            throw new Error('Cycle detected in LightSOPLang declarations');
        }

        return levels;
    }

    async _requestLlmaCode(reason, context) {
        if (!this.llmAgent || !this.englishContext) {
            throw new Error('LLMAgent not configured for english scripts');
        }
        if (typeof this.llmAgent.executePrompt !== 'function') {
            throw new Error('LLMAgent must provide executePrompt(promptText)');
        }
        if (this.englishContext.attempt >= this.maxLlmaRounds) {
            return null;
        }

        const request = {
            instructions: this.englishContext.instructions,
            attempt: this.englishContext.attempt,
            reason,
            failures: context.failures ?? [],
            variables: context.variables ?? [],
            previousCode: context.previousCode ?? this.englishContext.lastCode ?? null,
            history: this.englishContext.history.slice(),
            commands: this._listCommands(),
        };

        const prompt = this._buildLlmaPrompt(request);
        this.executionMonitor.beforeRegenerateScript({ prompt, request });

        const llmModel = this.llmModel || null;
        const generated = await this.llmAgent.executePrompt(prompt, {
            model: llmModel,
            tags: this.llmTags,
            reasoningEffort: this.llmReasoningEffort || null,
            signal: this.llmSignal,
        });
        if (typeof generated !== 'string' || !generated.trim()) {
            throw new Error('LLMAgent returned empty code');
        }
        // Strip markdown code fences that LLMs commonly wrap around generated code
        let trimmed = generated.trim();
        const fenceMatch = trimmed.match(/^```[\w]*\s*\n([\s\S]*?)\n\s*```\s*$/);
        if (fenceMatch) {
            trimmed = fenceMatch[1].trim();
        }
        this.englishContext.history.push({
            attempt: this.englishContext.attempt,
            code: trimmed,
            reason,
            prompt,
        });
        this.englishContext.attempt += 1;
        this.englishContext.lastCode = trimmed;
        return trimmed;
    }
}

export default LightSOPLangInterpreter;
