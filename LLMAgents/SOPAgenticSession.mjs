import { LightSOPLangInterpreter } from '../lightSOPLang/interpreter.mjs';
import { buildSOPAgenticInstructions } from './templates/sopAgenticSessionPrompts.mjs';

class SOPAgenticSession {
    constructor({ agent, skillsDescription, options = {} }) {
        if (!agent) {
            throw new Error('SOPAgenticSession requires an LLMAgent instance.');
        }
        if (!skillsDescription || typeof skillsDescription !== 'object') {
            throw new Error('SOPAgenticSession requires a skillsDescription object.');
        }

        this.agent = agent;
        this.skillsDescription = skillsDescription;
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
            ? options.commandsRegistry
            : null;
        this.planCommandsRegistry = this._createPlanCommandsRegistry();

        this.history = [];
        this.currentPlan = '';
        this.lastExecution = null;
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

        return { plan: this.currentPlan };
    }

    async getVariables() {
        const base = { lastPlan: this.currentPlan };
        if (this.lastExecution) {
            return {
                ...base,
                variables: this.lastExecution.variables,
                lastAnswer: this.lastExecution.lastAnswer ?? null,
            };
        }
        return base;
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
            lastAnswer: variables.lastAnswer ?? null,
        };
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

}

export {
    SOPAgenticSession,
};
