import { LightSOPLangInterpreter } from '../lightSOPLang/interpreter.mjs';
import { buildSOPAgenticInstructions } from './templates/sopAgenticSessionPrompts.mjs';
import {
    RETURN_RESPONSE_TOOL,
    RETURN_RESPONSE_DESCRIPTION,
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
        if (Object.prototype.hasOwnProperty.call(skillsDescription, RETURN_RESPONSE_TOOL)) {
            throw new Error(`Tool name "${RETURN_RESPONSE_TOOL}" is reserved by the agent runtime.`);
        }

        if (agent) {
            if (agent.__toolState instanceof Map) {
                agent.__toolState.clear();
            } else {
                agent.__toolState = new Map();
            }
        }

        this.agent = agent;
        this.skillsDescription = { ...skillsDescription };
        this.skillsDescription[RETURN_RESPONSE_TOOL] = RETURN_RESPONSE_DESCRIPTION;
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

        this.history = [];
        this.currentPlan = '';
        this.lastExecution = null;
        this._lastReturnResponse = null;
    }

    async newPrompt(userPrompt) {
        if (!userPrompt || typeof userPrompt !== 'string') {
            throw new Error('newPrompt requires a prompt string.');
        }

        const modeHint = this.options.planOnly ? ' plan-only' : '';
        // eslint-disable-next-line no-console
        console.log(`[SOPAgenticSession${modeHint}] New prompt: "${userPrompt}"`);

        const englishInstructions = buildSOPAgenticInstructions({
            currentPlan: this.currentPlan,
            userPrompt,
        });

        const plan = await this._generatePlanFromEnglish(englishInstructions);

        this.currentPlan = plan || '';
        this.lastExecution = null;
        this.history.push({
            prompt: userPrompt,
            plan: this.currentPlan,
        });

        if (this.commandsRegistry && !this.options.planOnly) {
            await this._runPlan(this.currentPlan);
        }

        return { plan: this.currentPlan, answer: this.getLastResult() };
    }

    getLastResult() {
        return this.lastExecution?.lastAnswer ?? null;
    }

    async getVariables() {
        return {
            lastPlan: this.currentPlan,
            lastAnswer: this.lastExecution?.lastAnswer ?? null,
            status: this.lastExecution ? 'active' : 'idle',
        };
    }

    async getPlan() {
        return this.getSOPLangPlan();
    }

    getSOPLangPlan() {
        return this.currentPlan;
    }

    async _runPlan(planSource) {
        if (!planSource || !planSource.trim()) {
            this.lastExecution = null;
            return;
        }
        const interpreterOptions = {
            ...this.executionInterpreterOptions,
        };
        if (!Object.prototype.hasOwnProperty.call(interpreterOptions, 'llmAgent')) {
            interpreterOptions.llmAgent = this.agent;
        }
        this._lastReturnResponse = null;
        const interpreter = new LightSOPLangInterpreter(
            planSource,
            this.commandsRegistry,
            interpreterOptions,
        );
        await interpreter.ready;
        const variables = {};
        for (const [varName] of interpreter.variables) {
            variables[varName] = interpreter.getVarValue(varName);
        }
        this.lastExecution = {
            variables,
            lastAnswer: this._lastReturnResponse ?? variables.lastAnswer ?? null,
        };
        this._lastReturnResponse = null;
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
                if (payload?.command === RETURN_RESPONSE_TOOL) {
                    const text = normalizeResponsePayload(payload?.args?.[0] ?? '');
                    this._lastReturnResponse = text;
                    return responder.success(text);
                }
                return executeCommand(payload, responder);
            },
            listCommands: () => {
                const commands = listCommands() || [];
                if (!commands.some((cmd) => (cmd?.name || cmd?.command) === RETURN_RESPONSE_TOOL)) {
                    commands.push({
                        name: RETURN_RESPONSE_TOOL,
                        description: RETURN_RESPONSE_DESCRIPTION,
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
