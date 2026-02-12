import { LightSOPLangInterpreter } from '../lightSOPLang/interpreter.mjs';
import { buildSOPAgenticInstructions, buildPreparationPrompt } from './templates/sopAgenticSessionPrompts.mjs';
import {
    FINAL_ANSWER_TOOL,
    FINAL_ANSWER_DESCRIPTION,
    CANNOT_COMPLETE_TOOL,
    CANNOT_COMPLETE_DESCRIPTION,
    normalizeResponsePayload,
} from './constants.mjs';

const DEBUG_ENABLED = String(process.env.ACHILLES_DEBUG ?? '').toLowerCase() === 'true';

const PREPARATION_CONTEXT_PREFIX = '@context_';

function injectContextIntoPrompt(promptText, contextLines = []) {
    if (!contextLines.length) {
        return promptText;
    }
    const block = contextLines.join('\n');
    if (!promptText) {
        return block;
    }
    return `${promptText}\n\n${block}`;
}

function debugLog(...args) {
    if (DEBUG_ENABLED) console.log(...args);
}

function coerceResultToText(result) {
    if (result == null) {
        return '';
    }
    if (typeof result === 'string') {
        return result;
    }
    if (typeof result === 'object') {
        if (typeof result.text === 'string') {
            return result.text;
        }
        if (typeof result.output === 'string') {
            return result.output;
        }
        if (typeof result.result === 'string') {
            return result.result;
        }
        try {
            return JSON.stringify(result);
        } catch (error) {
            return String(result);
        }
    }
    return String(result);
}

function parseContextVariables(text = '', prefix = PREPARATION_CONTEXT_PREFIX) {
    if (!text) {
        return [];
    }
    const lines = text.split(/\r?\n/);
    const entries = [];
    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line.startsWith(prefix)) {
            continue;
        }
        const match = line.match(/^(@context_[A-Za-z0-9_-]+)\s*(?::=|:|=)\s*(.+)$/);
        if (!match) {
            continue;
        }
        let value = match[2].trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        entries.push({
            name: match[1],
            value,
        });
    }
    return entries;
}

function buildContextPieceLines(entries = [], fallbackValue = '') {
    const safeEntries = Array.isArray(entries) ? entries : [];
    if (!safeEntries.length && fallbackValue) {
        const safeValue = String(fallbackValue ?? '').replace(/"/g, '\\"');
        return [`@context_piece_1 has the value "${safeValue}"`];
    }
    return safeEntries.map((entry, index) => {
        const explicitName = String(entry.name || '').trim();
        const name = explicitName || `@context_piece_${index + 1}`;
        const safeValue = String(entry.value ?? '').replace(/"/g, '\\"');
        return `${name} has the value "${safeValue}"`;
    });
}

function escapeSopString(value) {
    return String(value ?? '')
        .replace(/\\/g, '\\\\')
        .replace(/\r/g, '\\r')
        .replace(/\n/g, '\\n')
        .replace(/\t/g, '\\t')
        .replace(/"/g, '\\"');
}

function buildAssignLines(entries = []) {
    const lines = [];
    entries.forEach((entry, index) => {
        const explicitName = String(entry?.name || '').trim();
        const name = explicitName || `@context_piece_${index + 1}`;
        const safeValue = escapeSopString(entry?.value ?? '');
        lines.push(`${name} assign "${safeValue}"`);
    });
    return lines;
}


function buildContextNameFromVariable(variableName) {
    const rawName = String(variableName ?? '').replace(/^\$+/, '');
    const sanitized = rawName.replace(/[^A-Za-z0-9_-]/g, '_');
    if (!sanitized) {
        return '';
    }
    return `@context_${sanitized}`;
}

async function runWithRetry(fn, retries = 1) {
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;
        }
    }
    throw lastError;
}

class SOPAgenticSession {
    constructor({ agent, skillsDescription, options = {} }) {
        if (!agent) {
            throw new Error('SOPAgenticSession requires an LLMAgent instance.');
        }
        if (!skillsDescription || typeof skillsDescription !== 'object') {
            throw new Error('SOPAgenticSession requires a skillsDescription object.');
        }
        [FINAL_ANSWER_TOOL, CANNOT_COMPLETE_TOOL].forEach((reserved) => {
            if (Object.prototype.hasOwnProperty.call(skillsDescription, reserved)) {
                throw new Error(`Tool name "${reserved}" is reserved by the agent runtime.`);
            }
        });

        if (agent) {
            if (agent.__toolState instanceof Map) {
                agent.__toolState.clear();
            } else {
                agent.__toolState = new Map();
            }
        }

        this.agent = agent;
        this._userSkillsDescription = { ...skillsDescription };
        this.skillsDescription = { ...skillsDescription };
        this.skillsDescription[FINAL_ANSWER_TOOL] = FINAL_ANSWER_DESCRIPTION;
        this.skillsDescription[CANNOT_COMPLETE_TOOL] = CANNOT_COMPLETE_DESCRIPTION;
        const planOnlyFlag = options.planOnly ?? options.generatePlanOnly ?? false;
        this.options = {
            ...options,
            mode: options.mode || 'deep',
            model: options.model || null,
            planOnly: planOnlyFlag,
        };
        this.executionInterpreterOptions = options.interpreterOptions || {};
        this.planGeneratorOptions = options.planGeneratorOptions
            || options.planGenerator
            || this.executionInterpreterOptions
            || {};
        this._unwrappedCommandsRegistry = options.commandsRegistry || null;
        this.commandsRegistry = options.commandsRegistry && typeof options.commandsRegistry === 'object'
            ? this._wrapExecutionRegistry(options.commandsRegistry)
            : null;
        this.planCommandsRegistry = this._createPlanCommandsRegistry();
        this.systemPrompt = typeof options.systemPrompt === 'string' ? options.systemPrompt : '';
        this.baseSystemPrompt = this.systemPrompt;
        this.preparation = options.preparation || null;

        this.history = [];
        this.currentPlan = '';
        this.lastExecution = null;
        this._lastFinalAnswer = null;
        this.preparationContextEntries = [];
        this.maxPlanAttempts = Number.isFinite(options.maxPlanAttempts)
            ? options.maxPlanAttempts
            : 3;
        this.lastRunFailures = [];
    }

    static async runPreparation({
        agent,
        skillsDescription,
        commandsRegistry,
        options = {},
        preparationText,
        userPrompt,
        contextPrefix = PREPARATION_CONTEXT_PREFIX,
        retries = 1,
    }) {
        const preparationPrompt = buildPreparationPrompt(preparationText, userPrompt);
        if (!preparationPrompt) {
            return { contextEntries: [], contextLines: [] };
        }

        debugLog('[SOPAgenticSession] Preparation start', {
            preparationLength: String(preparationText || '').length,
            userPromptLength: String(userPrompt || '').length,
            retries,
        });

        const attemptRun = async () => {
            const sessionOptions = {
                ...options,
                planOnly: false,
                systemPrompt: 'Plan and execute skills to prepare context for the user request.',
                commandsRegistry,
                allowMultiFinalArgs: true,
            };
            const session = new SOPAgenticSession({
                agent,
                skillsDescription,
                options: sessionOptions,
            });
            debugLog('[SOPAgenticSession] Preparation session start', {
                promptLength: String(preparationPrompt || '').length,
            });
            await session.newPrompt(preparationPrompt);
            const failures = Array.isArray(session.lastRunFailures) ? session.lastRunFailures : [];
            if (failures.length) {
                debugLog('[SOPAgenticSession] Preparation session failures', {
                    failureCount: failures.length,
                });
                throw new Error('Preparation SOP plan reported failures.');
            }
            const lastResult = session.getLastResult();
            const resultText = coerceResultToText(lastResult);
            const contextEntries = parseContextVariables(resultText, contextPrefix);
            if (lastResult && typeof lastResult === 'object' && lastResult.type === 'multi-final-args') {
                const values = Array.isArray(lastResult.values) ? lastResult.values : [];
                const names = Array.isArray(lastResult.names) ? lastResult.names : [];
                values.forEach((value, index) => {
                    const rawName = names[index];
                    const contextName = rawName
                        ? buildContextNameFromVariable(rawName)
                        : `@context_piece_${index + 1}`;
                    if (!contextName) {
                        return;
                    }
                    contextEntries.push({ name: contextName, value });
                });
            }
            const contextLines = buildContextPieceLines(contextEntries, resultText);
            const preparationPlan = session.currentPlan || '';
            debugLog('[SOPAgenticSession] Preparation result parsed', {
                rawTextLength: String(resultText || '').length,
                contextEntries: contextEntries.length,
                contextLines: contextLines.length,
            });
            return { contextEntries, contextLines, rawText: resultText, preparationPlan };
        };

        return runWithRetry(attemptRun, retries);
    }
 
     async newPrompt(userPrompt) {

        if (!userPrompt || typeof userPrompt !== 'string') {
            throw new Error('newPrompt requires a prompt string.');
        }

        // Run preparation if configured
        if (this.preparation?.text) {
            const prepResult = await SOPAgenticSession.runPreparation({
                agent: this.agent,
                skillsDescription: this._userSkillsDescription,
                commandsRegistry: this._unwrappedCommandsRegistry,
                options: { mode: this.options.mode },
                preparationText: this.preparation.text,
                userPrompt,
                retries: this.preparation.retries ?? 1,
            });
            const contextLines = prepResult?.contextLines || [];
            const preparationPlan = prepResult?.preparationPlan || '';
            this.preparationContextEntries = Array.isArray(prepResult?.contextEntries)
                ? prepResult.contextEntries
                : [];
            const systemContextLines = [];

            if (preparationPlan) {
                systemContextLines.push('As preparation to provide context, the following plan was executed:');
                systemContextLines.push(preparationPlan);
                systemContextLines.push('');
            }
            if (contextLines.length) {
                systemContextLines.push('You can use these variables as context if needed.');
                systemContextLines.push(...contextLines);
            }

            this.systemPrompt = injectContextIntoPrompt(this.baseSystemPrompt, systemContextLines);
            userPrompt = injectContextIntoPrompt(userPrompt, contextLines);
        }

        const modeHint = this.options.planOnly ? ' plan-only' : '';
        debugLog(`[SOPAgenticSession${modeHint}] New prompt: "${userPrompt}"`);
 
        const maxAttempts = this.maxPlanAttempts > 0 ? this.maxPlanAttempts : 1;
        let attempt = 0;
        let lastFeedback = null;
 
        while (true) {
            const baseInstructions = buildSOPAgenticInstructions({
                currentPlan: this.currentPlan,
                userPrompt,
                systemPrompt: this.systemPrompt,
            });
 
            const feedbackBlock = this._buildExecutionFeedbackComment(lastFeedback);
            const englishInstructions = feedbackBlock
                ? `${baseInstructions}\n\n${feedbackBlock}`
                : baseInstructions;
 
            const plan = await this._generatePlanFromEnglish(englishInstructions);
 
            this.currentPlan = plan || '';
            this.lastExecution = null;
            this.history.push({
                prompt: userPrompt,
                plan: this.currentPlan,
            });
 
            if (!this.commandsRegistry || this.options.planOnly) {
                break;
            }
 
            const runResult = await this._runPlan(this.currentPlan);
            const hasFailures = runResult?.hasFailures;
            const failures = runResult?.failures || [];
            this.lastRunFailures = failures;
 
            if (!hasFailures) {
                break;
            }
 
            attempt += 1;
            if (attempt >= maxAttempts) {
                debugLog('[SOPAgenticSession] Maximum plan attempts reached; stopping retries.');
                break;
            }
 
            lastFeedback = {
                failures,
                variables: this.lastExecution?.variables || {},
            };
        }
 
        const answer = this.getLastResult();
        if (this.lastExecution && answer !== this.lastExecution.lastAnswer) {
            throw new Error('SOPAgenticSession invariant violated: getLastResult() mismatch with lastExecution.lastAnswer.');
        }
 
        return { plan: this.currentPlan, answer };
     }
 
     getLastResult() {

        return this.lastExecution?.lastAnswer ?? null;
    }
 
    async getVariables() {
        return {
            lastPlan: this.currentPlan,
            lastAnswer: this.getLastResult(),
            variables: this.lastExecution?.variables || {},
            status: this.lastExecution ? 'active' : 'idle',
        };
    }


    async getPlan() {
        return this.currentPlan;
    }


    async _runPlan(planSource) {
        if (!planSource || !planSource.trim()) {
            this.lastExecution = null;
            return { hasFailures: false, failures: [] };
        }
        const contextAssignLines = buildAssignLines(this.preparationContextEntries);
        const planWithContext = contextAssignLines.length
            ? `${contextAssignLines.join('\n')}\n${planSource}`
            : planSource;
        if (planWithContext !== planSource) {
            debugLog('[SOPAgenticSession] Executing plan with injected context variables:');
            debugLog(planWithContext);
        }
        const baseOptions = this.executionInterpreterOptions || {};
        const originalOnFail = typeof baseOptions.onFail === 'function'
            ? baseOptions.onFail
            : null;
        const collectedFailures = [];
        const interpreterOptions = {
            ...baseOptions,
            onFail: (failures) => {
                if (Array.isArray(failures)) {
                    collectedFailures.splice(0, collectedFailures.length, ...failures);
                }
                if (originalOnFail) {
                    try {
                        originalOnFail(failures);
                    } catch (error) {
                        // eslint-disable-next-line no-console
                        console.error('[SOPAgenticSession] execution onFail handler threw:', error);
                    }
                }
            },
        };
        if (!Object.prototype.hasOwnProperty.call(interpreterOptions, 'llmAgent')) {
            interpreterOptions.llmAgent = this.agent;
        }
            this._lastFinalAnswer = null;
        let interpreter;
        try {
            interpreter = new LightSOPLangInterpreter(
                planWithContext,
                this.commandsRegistry,
                interpreterOptions,
            );
            await interpreter.ready;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            // eslint-disable-next-line no-console
            console.error('[SOPAgenticSession] Plan execution failed:', message);
            this.lastExecution = {
                variables: {},
                lastAnswer: null,
            };
            const failures = [{
                variable: '__plan__',
                reason: `plan-error:${message}`,
            }];
            return { hasFailures: true, failures };
        }
        const variables = {};
        for (const [varName] of interpreter.variables) {
            variables[varName] = interpreter.getVarValue(varName);
        }
        const derivedLastAnswer = this._deriveLastAnswerFromVariables(variables);
        this.lastExecution = {
            variables,
            lastAnswer: this._lastFinalAnswer ?? derivedLastAnswer,
        };
        this._lastFinalAnswer = null;
        const hasFailures = collectedFailures.length > 0;
        const failures = hasFailures ? collectedFailures : [];
        this.lastRunFailures = failures;
        return { hasFailures, failures };
    }
 
    _deriveLastAnswerFromVariables(variables) {
        if (!variables || typeof variables !== 'object') {
            return null;
        }
        if (variables.lastAnswer !== undefined && variables.lastAnswer !== null) {
            return variables.lastAnswer;
        }
        const priorityKeys = ['result', 'final', 'answer', 'domain'];
        for (const key of priorityKeys) {
            if (Object.prototype.hasOwnProperty.call(variables, key)
                && variables[key] !== undefined
                && variables[key] !== null) {
                return variables[key];
            }
        }
        const names = Object.keys(variables);
        if (names.length === 1) {
            const soleValue = variables[names[0]];
            return soleValue !== undefined ? soleValue : null;
        }
        return null;
    }
 
    _buildExecutionFeedbackComment(feedback) {
        if (!feedback || !Array.isArray(feedback.failures)) {
            return '';
        }
        const { failures, variables } = feedback;
        if (!failures.length && (!variables || typeof variables !== 'object')) {
            return '';
        }
        const lines = [];
        lines.push('---');
        lines.push('Execution feedback from previous SOP plan:');
        if (failures.length) {
            lines.push('Failed variables:');
            failures.forEach((entry) => {
                lines.push(`- ${entry.variable}: ${entry.reason}`);
            });
        } else {
            lines.push('No failed variables were reported, but the plan did not meet expectations.');
        }
        const entries = variables && typeof variables === 'object'
            ? Object.entries(variables)
            : [];
        if (entries.length) {
            lines.push('Variable snapshot:');
            entries.forEach(([name, value]) => {
                lines.push(`- ${name}: ${String(value)}`);
            });
        }
        lines.push('Please update ONLY the LightSOPLang code to fix these issues.');
        lines.push('You may retry failing commands, adjust arguments, or add new steps.');
        lines.push(`Keep using "@lastAnswer ${FINAL_ANSWER_TOOL} <final text>" as the final step, or "@lastAnswer ${CANNOT_COMPLETE_TOOL} <reason>" when truly impossible.`);
        return lines.join('\n');
    }
 
     async _generatePlanFromEnglish(instructions) {


        const trimmed = typeof instructions === 'string' ? instructions.trim() : '';
        if (!trimmed) {
            return '';
        }
        const englishSource = trimmed.startsWith('#!english')
            ? trimmed
            : `#!english
${trimmed}`;
        const planOptions = {
            ...this.planGeneratorOptions,
            llmAgent: this.agent,
            generateOnly: true,
            onPlanGenerated: (event) => {
                try {
                    const previous = typeof event?.previousCode === 'string' ? event.previousCode : '';
                    const current = typeof event?.code === 'string' ? event.code : '';
                    const reason = event?.reason || 'unknown';
                    const attempt = Number.isFinite(event?.attempt) ? event.attempt : 0;
                    const COLOR_RESET = '\x1b[0m';
                    const COLOR_GREEN = '\x1b[32m';
                    const COLOR_RED = '\x1b[31m';
                    const COLOR_YELLOW = '\x1b[33m';
                    const COLOR_DIM = '\x1b[2m';

                    debugLog(`[LightSOPLang] Plan generation (${reason}, attempt ${attempt})`);

                    if (!previous) {
                        debugLog('[LightSOPLang] Generated initial plan:');
                        debugLog(current || '(empty plan)');
                        return;
                    }

                    const buildVarMap = (code) => {
                        const map = new Map();
                        if (!code || typeof code !== 'string') {
                            return map;
                        }
                        const lines = code.split(/\r?\n/);
                        for (const rawLine of lines) {
                            const line = rawLine.trim();
                            if (!line.startsWith('@')) {
                                continue;
                            }
                            const afterAt = line.slice(1).trim();
                            if (!afterAt) {
                                continue;
                            }
                            const [name] = afterAt.split(/\s+/, 1);
                            if (!name) {
                                continue;
                            }
                            map.set(name, line);
                        }
                        return map;
                    };

                    const prevVars = buildVarMap(previous);
                    const currVars = buildVarMap(current);

                    debugLog('[LightSOPLang] Plan diff by variable:');

                    const allNames = new Set([...prevVars.keys(), ...currVars.keys()]);
                    const sortedNames = Array.from(allNames).sort();

                    for (const name of sortedNames) {
                        const oldLine = prevVars.get(name) || '';
                        const newLine = currVars.get(name) || '';
                        if (oldLine && !newLine) {
                            // Removed
                            debugLog(`${COLOR_RED}- [REMOVED]${COLOR_RESET} ${name}: ${oldLine}`);
                        } else if (!oldLine && newLine) {
                            // Added
                            debugLog(`${COLOR_GREEN}+ [ADDED]${COLOR_RESET}   ${name}: ${newLine}`);
                        } else if (oldLine !== newLine) {
                            // Changed
                            debugLog(`${COLOR_YELLOW}~ [CHANGED]${COLOR_RESET} ${name}:`);
                            debugLog(`    old: ${oldLine}`);
                            debugLog(`    new: ${newLine}`);
                        } else {
                            // Unchanged
                            debugLog(`${COLOR_DIM}= [UNCHANGED]${COLOR_RESET} ${name}: ${oldLine}`);
                        }
                    }
                } catch (logError) {
                    // eslint-disable-next-line no-console
                    console.error('[LightSOPLang] Failed to log plan diff:', logError);
                }
            },
        };
        const interpreter = new LightSOPLangInterpreter(
            englishSource,
            this.planCommandsRegistry,
            planOptions,
        );
        await interpreter.ready;
        return interpreter.currentSourceCode || '';
    }

    _createPlanCommandsRegistry() {
        return {
            executeCommand: async () => ({ status: 'success', data: 'noop' }),
            listCommands: () => Object.entries(this.skillsDescription).map(([name, description]) => ({
                name,
                description,
            })),
        };
    }

    _wrapExecutionRegistry(registry) {
        if (typeof registry.executeCommand !== 'function' || typeof registry.listCommands !== 'function') {
            throw new Error('commandsRegistry must provide executeCommand and listCommands functions.');
        }
        const executeCommand = registry.executeCommand.bind(registry);
        const listCommands = registry.listCommands.bind(registry);
        return {
            executeCommand: async (payload, responder) => {
                if (payload?.command === FINAL_ANSWER_TOOL) {
                    const args = Array.isArray(payload?.args) ? payload.args : [];
                    const allowMultiFinalArgs = Boolean(this.options.allowMultiFinalArgs);
                    if (allowMultiFinalArgs && args.length > 1) {
                        const argMeta = Array.isArray(payload?.variableState?.arguments)
                            ? payload.variableState.arguments
                            : [];
                        const names = argMeta.map((arg) => (arg?.type === 'variable' ? arg.name : null));
                        const multiResult = {
                            type: 'multi-final-args',
                            values: args,
                            names,
                        };
                        this._lastFinalAnswer = multiResult;
                        return responder.success(multiResult);
                    }
                    const text = normalizeResponsePayload(args[0] ?? '');
                    this._lastFinalAnswer = text;
                    return responder.success(text);
                }
                if (payload?.command === CANNOT_COMPLETE_TOOL) {
                    const text = normalizeResponsePayload(payload?.args?.[0] ?? '');
                    this._lastFinalAnswer = text;
                    return responder.fail(text);
                }
                return executeCommand(payload, responder);
            },
            listCommands: () => {
                const commands = listCommands() || [];
                const names = commands.map((cmd) => cmd?.name || cmd?.command);
                if (!names.includes(FINAL_ANSWER_TOOL)) {
                    commands.push({
                        name: FINAL_ANSWER_TOOL,
                        description: FINAL_ANSWER_DESCRIPTION,
                    });
                }
                if (!names.includes(CANNOT_COMPLETE_TOOL)) {
                    commands.push({
                        name: CANNOT_COMPLETE_TOOL,
                        description: CANNOT_COMPLETE_DESCRIPTION,
                    });
                }
                return commands;
            },
        };
    }

}

export {
    SOPAgenticSession,
};
