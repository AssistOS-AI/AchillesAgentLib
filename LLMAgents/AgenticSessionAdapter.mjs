import { LoopAgentSession } from './AgenticSession.mjs';
import { SOPAgenticSession } from './SOPAgenticSession.mjs';
import { JSONPlanSession } from './JSONPlanSession.mjs';
import { MDPlanSession } from './MDPlanSession.mjs';
import {
    SESSION_STATUS_IDLE,
    SESSION_STATUS_AWAITING_INPUT,
} from './constants.mjs';

/**
 * Unified skill input format for all adapters:
 *   skills: [{ name: string, description: string, handler: async (agent, promptText) => result }]
 */

class AgenticSessionAdapter {
    constructor({ agent, skills, options = {} }) {
        this.agent = agent;
        this.skills = skills;
        this.options = options;
        this._session = null;
        this._startTime = null;
    }

    async newPrompt(userPrompt) {
        throw new Error('newPrompt() must be implemented by subclass.');
    }

    getLastResult() {
        return this._session?.getLastResult?.() ?? null;
    }

    get status() {
        return this._session?.status ?? SESSION_STATUS_IDLE;
    }

    async getVariables() {
        return this._session?.getVariables?.() ?? {};
    }

    getMetrics() {
        const durationMs = this._startTime ? Date.now() - this._startTime : 0;
        const sessionMetrics = this._session?._metrics || {};
        return { durationMs, ...sessionMetrics };
    }
}

class LoopSessionAdapter extends AgenticSessionAdapter {
    constructor({ agent, skills, options = {} }) {
        super({ agent, skills, options });
        const tools = {};
        for (const skill of skills) {
            tools[skill.name] = {
                handler: skill.handler,
                description: skill.description,
            };
        }
        this._session = new LoopAgentSession({
            agent,
            tools,
            options,
        });
    }

    async newPrompt(userPrompt) {
        this._startTime = Date.now();
        await this._session.newPrompt(userPrompt);
        return this._session.getLastResult();
    }

    get status() {
        return this._session.status;
    }
}

class SOPSessionAdapter extends AgenticSessionAdapter {
    constructor({ agent, skills, options = {} }) {
        super({ agent, skills, options });

        const skillsDescription = {};
        const skillHandlers = {};
        for (const skill of skills) {
            skillsDescription[skill.name] = skill.description;
            skillHandlers[skill.name] = skill.handler;
        }

        const commandsRegistry = {
            executeCommand: async (payload, response) => {
                const { command, args } = payload;
                const handler = skillHandlers[command];
                if (!handler) {
                    return response.fail(`Unknown skill: ${command}`);
                }
                try {
                    const prompt = Array.isArray(args)
                        ? args.map((v) => (v == null ? '' : String(v))).join(' ')
                        : (args == null ? '' : String(args));
                    const result = await handler(agent, prompt);
                    return response.success(result);
                } catch (error) {
                    return response.fail(error?.message || String(error));
                }
            },
            listCommands: () => skills.map((s) => ({
                name: s.name,
                description: s.description,
            })),
        };

        this._session = new SOPAgenticSession({
            agent,
            skillsDescription,
            options: {
                ...options,
                commandsRegistry,
            },
        });
    }

    async newPrompt(userPrompt) {
        this._startTime = Date.now();
        const { answer } = await this._session.newPrompt(userPrompt);
        return answer;
    }

    get status() {
        if (this._session.lastExecution) {
            return this._session.lastExecution.lastAnswer != null
                ? SESSION_STATUS_AWAITING_INPUT
                : SESSION_STATUS_IDLE;
        }
        return SESSION_STATUS_IDLE;
    }

    getLastResult() {
        return this._session.getLastResult();
    }
}

class JSONPlanSessionAdapter extends AgenticSessionAdapter {
    constructor({ agent, skills, options = {} }) {
        super({ agent, skills, options });

        const skillsDescription = {};
        const skillHandlers = {};
        for (const skill of skills) {
            skillsDescription[skill.name] = skill.description;
            skillHandlers[skill.name] = skill.handler;
        }

        const commandsRegistry = {
            executeCommand: async (payload, response) => {
                const { command, args } = payload;
                const handler = skillHandlers[command];
                if (!handler) {
                    return response.fail(`Unknown skill: ${command}`);
                }
                try {
                    const prompt = Array.isArray(args)
                        ? args.map((v) => (v == null ? '' : String(v))).join(' ')
                        : (args == null ? '' : String(args));
                    const result = await handler(agent, prompt);
                    return response.success(result);
                } catch (error) {
                    return response.fail(error?.message || String(error));
                }
            },
            listCommands: () => skills.map((s) => ({
                name: s.name,
                description: s.description,
            })),
        };

        this._session = new JSONPlanSession({
            agent,
            skillsDescription,
            options: {
                ...options,
                commandsRegistry,
            },
        });
    }

    async newPrompt(userPrompt) {
        this._startTime = Date.now();
        const { answer } = await this._session.newPrompt(userPrompt);
        return answer;
    }

    get status() {
        if (this._session.lastExecution) {
            return this._session.lastExecution.lastAnswer != null
                ? SESSION_STATUS_AWAITING_INPUT
                : SESSION_STATUS_IDLE;
        }
        return SESSION_STATUS_IDLE;
    }

    getLastResult() {
        return this._session.getLastResult();
    }
}

class MDPlanSessionAdapter extends AgenticSessionAdapter {
    constructor({ agent, skills, options = {} }) {
        super({ agent, skills, options });

        const skillsDescription = {};
        const skillHandlers = {};
        for (const skill of skills) {
            skillsDescription[skill.name] = skill.description;
            skillHandlers[skill.name] = skill.handler;
        }

        const commandsRegistry = {
            executeCommand: async (payload, response) => {
                const { command, args } = payload;
                const handler = skillHandlers[command];
                if (!handler) {
                    return response.fail(`Unknown skill: ${command}`);
                }
                try {
                    const prompt = Array.isArray(args)
                        ? args.map((v) => (v == null ? '' : String(v))).join(' ')
                        : (args == null ? '' : String(args));
                    const result = await handler(agent, prompt);
                    return response.success(result);
                } catch (error) {
                    return response.fail(error?.message || String(error));
                }
            },
            listCommands: () => skills.map((s) => ({
                name: s.name,
                description: s.description,
            })),
        };

        this._session = new MDPlanSession({
            agent,
            skillsDescription,
            options: {
                ...options,
                commandsRegistry,
            },
        });
    }

    async newPrompt(userPrompt) {
        this._startTime = Date.now();
        const { answer } = await this._session.newPrompt(userPrompt);
        return answer;
    }

    get status() {
        if (this._session.lastExecution) {
            return this._session.lastExecution.lastAnswer != null
                ? SESSION_STATUS_AWAITING_INPUT
                : SESSION_STATUS_IDLE;
        }
        return SESSION_STATUS_IDLE;
    }

    getLastResult() {
        return this._session.getLastResult();
    }
}

function createSessionAdapter(type, { agent, skills, options }) {
    if (type === 'sop') {
        return new SOPSessionAdapter({ agent, skills, options });
    }
    if (type === 'json') {
        return new JSONPlanSessionAdapter({ agent, skills, options });
    }
    if (type === 'md') {
        return new MDPlanSessionAdapter({ agent, skills, options });
    }
    return new LoopSessionAdapter({ agent, skills, options });
}

export {
    AgenticSessionAdapter,
    LoopSessionAdapter,
    SOPSessionAdapter,
    JSONPlanSessionAdapter,
    MDPlanSessionAdapter,
    createSessionAdapter,
};
