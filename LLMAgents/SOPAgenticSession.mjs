import { LightSOPLangInterpreter } from '../lightSOPLang/interpreter.mjs';
import { buildSOPAgenticInstructions } from './templates/sopAgenticSessionPrompts.mjs';
import {
    FINAL_ANSWER_TOOL,
    FINAL_ANSWER_DESCRIPTION,
    CANNOT_COMPLETE_TOOL,
    CANNOT_COMPLETE_DESCRIPTION,
    normalizeResponsePayload,
} from './constants.mjs';

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
        this.commandsRegistry = options.commandsRegistry && typeof options.commandsRegistry === 'object'
            ? this._wrapExecutionRegistry(options.commandsRegistry)
            : null;
        this.planCommandsRegistry = this._createPlanCommandsRegistry();
        this.systemPrompt = typeof options.systemPrompt === 'string' ? options.systemPrompt : '';

        this.history = [];
        this.currentPlan = '';
        this.lastExecution = null;
        this._lastFinalAnswer = null;
        this.maxPlanAttempts = Number.isFinite(options.maxPlanAttempts)
            ? options.maxPlanAttempts
            : 3;
    }
 
     async newPrompt(userPrompt) {

        if (!userPrompt || typeof userPrompt !== 'string') {
            throw new Error('newPrompt requires a prompt string.');
        }

        const modeHint = this.options.planOnly ? ' plan-only' : '';
        // eslint-disable-next-line no-console
        console.log(`[SOPAgenticSession${modeHint}] New prompt: "${userPrompt}"`);
 
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
 
            if (!hasFailures) {
                break;
            }
 
            attempt += 1;
            if (attempt >= maxAttempts) {
                // eslint-disable-next-line no-console
                console.log('[SOPAgenticSession] Maximum plan attempts reached; stopping retries.');
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
                    planSource,
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

                    // eslint-disable-next-line no-console
                    console.log(`[LightSOPLang] Plan generation (${reason}, attempt ${attempt})`);

                    if (!previous) {
                        // eslint-disable-next-line no-console
                        console.log('[LightSOPLang] Generated initial plan:');
                        // eslint-disable-next-line no-console
                        console.log(current || '(empty plan)');
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

                    // eslint-disable-next-line no-console
                    console.log('[LightSOPLang] Plan diff by variable:');

                    const allNames = new Set([...prevVars.keys(), ...currVars.keys()]);
                    const sortedNames = Array.from(allNames).sort();

                    for (const name of sortedNames) {
                        const oldLine = prevVars.get(name) || '';
                        const newLine = currVars.get(name) || '';
                        if (oldLine && !newLine) {
                            // Removed
                            // eslint-disable-next-line no-console
                            console.log(`${COLOR_RED}- [REMOVED]${COLOR_RESET} ${name}: ${oldLine}`);
                        } else if (!oldLine && newLine) {
                            // Added
                            // eslint-disable-next-line no-console
                            console.log(`${COLOR_GREEN}+ [ADDED]${COLOR_RESET}   ${name}: ${newLine}`);
                        } else if (oldLine !== newLine) {
                            // Changed
                            // eslint-disable-next-line no-console
                            console.log(`${COLOR_YELLOW}~ [CHANGED]${COLOR_RESET} ${name}:`);
                            // eslint-disable-next-line no-console
                            console.log(`    old: ${oldLine}`);
                            // eslint-disable-next-line no-console
                            console.log(`    new: ${newLine}`);
                        } else {
                            // Unchanged
                            // eslint-disable-next-line no-console
                            console.log(`${COLOR_DIM}= [UNCHANGED]${COLOR_RESET} ${name}: ${oldLine}`);
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
                    const text = normalizeResponsePayload(payload?.args?.[0] ?? '');
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
