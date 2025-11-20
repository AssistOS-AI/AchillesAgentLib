import {
    extractKeyValuePairs,
    extractIdeaList,
    classifyIntent,
    responseToJSON,
} from './markdown.mjs';
import { defaultLLMInvokerStrategy, cancelRequests } from '../utils/LLMClient.mjs';
import { logLLMInteraction } from '../utils/LLMLogger.mjs';
import {
    buildInterpretMessagePrompt,
    buildDetectIntentsPrompt,
    extractJson,
} from './templates/prompts.mjs';
import { AgenticSession } from './AgenticSession.mjs';
import { SOPAgenticSession } from './SOPAgenticSession.mjs';
import { stripCodeFence } from './LLMAgentHelpers.mjs';
import {
    extraDoTask,
    extraDoTaskWithReview,
    extraDoTaskWithHumanReview,
} from './LLMAgentExtra.mjs';

const DEFAULT_AGENT_NAME = 'DefaultLLMAgent';

class LLMAgent {
    constructor(options = {}) {
        const {
            name = DEFAULT_AGENT_NAME,
            invokerStrategy = null,
        } = options;

        if (!name || typeof name !== 'string') {
            throw new Error('LLMAgent requires a non-empty name.');
        }

        const resolvedStrategy = invokerStrategy || defaultLLMInvokerStrategy;
        if (typeof resolvedStrategy !== 'function') {
            throw new Error(`LLMAgent "${name}" requires an invokerStrategy function.`);
        }

        this.name = name;
        this.invokerStrategy = resolvedStrategy;
        this._debugEnabled = false;
        this._debugLogger = null;
        this._debugCounter = 0;
    }

    parseMarkdownKeyValues(markdown) {
        return extractKeyValuePairs(markdown);
    }

    parseMarkdownIdeas(markdown) {
        return extractIdeaList(markdown);
    }

    classifyMessage(message, options = {}) {
        return classifyIntent(message, options);
    }

    responseToJSON(markdown) {
        return responseToJSON(markdown);
    }

    async interpretMessage(message, { intents = ['accept', 'cancel', 'update'], instructions = null } = {}) {
        const heuristic = classifyIntent(message, { intents });
        if (heuristic.intent !== 'unknown' && (!intents.length || intents.includes(heuristic.intent))) {
            const hasMeaningfulUpdates = heuristic.updates && Object.keys(heuristic.updates).length;
            if (heuristic.intent !== 'update' || hasMeaningfulUpdates) {
                return heuristic;
            }
        }

        const prompt = buildInterpretMessagePrompt(intents, instructions);

        const raw = await this.complete({
            prompt,
            history: [{ role: 'user', message }],
            mode: 'fast',
            context: { intent: 'classify-message', expectedIntents: intents },
        });

        const keyValues = extractKeyValuePairs(raw);
        const ideas = extractIdeaList(raw);

        const primaryIntent = (keyValues.intent || keyValues.action || '').toLowerCase();
        const intent = primaryIntent && intents.includes(primaryIntent)
            ? primaryIntent
            : (ideas.length ? 'ideas' : 'unknown');

        const updatesRaw = keyValues.updates || keyValues.values;
        const updates = typeof updatesRaw === 'string'
            ? extractKeyValuePairs(updatesRaw)
            : updatesRaw || {};

        const fallbackUpdates = { ...keyValues };
        delete fallbackUpdates.intent;
        delete fallbackUpdates.action;
        delete fallbackUpdates.updates;
        delete fallbackUpdates.values;

        const mergedUpdates = { ...fallbackUpdates, ...updates };

        return {
            intent,
            confidence: intent === 'unknown' ? 0 : 0.6,
            updates: Object.keys(mergedUpdates).length ? mergedUpdates : undefined,
            ideas: ideas.length ? ideas : undefined,
            raw,
        };
    }

    setDebugLogger(logger) {
        this._debugLogger = typeof logger === 'function' ? logger : null;
    }

    setDebugEnabled(enabled) {
        this._debugEnabled = Boolean(enabled);
    }

    _emitDebugEvent(event) {
        if (!this._debugEnabled || typeof this._debugLogger !== 'function') {
            return;
        }
        try {
            this._debugLogger(event);
        } catch {
            // Avoid cascading failures from debug hooks
        }
    }

    _nextDebugRequestId() {
        this._debugCounter += 1;
        return `llm-${this._debugCounter}`;
    }

    getSupportedModes() {
        if (this.invokerStrategy && typeof this.invokerStrategy.getSupportedModes === 'function') {
            const modes = this.invokerStrategy.getSupportedModes();
            if (Array.isArray(modes) && modes.length) {
                return modes;
            }
        }
        return ['fast'];
    }

    async complete(options = {}) {
        const {
            prompt,
            history = [],
            mode = process.env.DEFAULT_MODEL_TYPE === 'deep' ? 'deep' : 'fast',
            model = null,
            context = {},
            ...invokerExtras
        } = options;

        if (!prompt || typeof prompt !== 'string') {
            throw new Error('complete requires a prompt string.');
        }

        const requestId = this._debugEnabled ? this._nextDebugRequestId() : null;
        const startedAt = Date.now();
        const emit = (event) => {
            if (!requestId) {
                return;
            }
            this._emitDebugEvent({
                id: requestId,
                method: 'complete',
                ...event,
            });
        };

        if (this._processingCallbacks?.onStart) {
            try {
                this._processingCallbacks.onStart();
            } catch (error) {
                // Silently ignore callback errors
            }
        }

        let responseMetadata = null;
        try {
            const conversation = Array.isArray(history) ? history.slice() : [];
            emit({
                phase: 'request',
                mode,
                model,
                prompt,
                history: conversation,
                context,
                options: invokerExtras,
            });
            const response = await this.invokerStrategy({
                prompt,
                history: conversation,
                mode,
                model,
                agent: this,
                context,
                ...invokerExtras,
            });

            if (this._processingCallbacks?.onEnd) {
                try {
                    this._processingCallbacks.onEnd();
                } catch (error) {
                    // Silently ignore callback errors
                }
            }

            let finalResponse = null;
            if (typeof response === 'string') {
                finalResponse = response;
            } else if (response && typeof response === 'object' && typeof response.output === 'string') {
                responseMetadata = response;
                finalResponse = response.output;
            } else {
                throw new Error('LLMAgent invokerStrategy must return a string response.');
            }
            emit({
                phase: 'response',
                output: finalResponse,
            });
            const loggedModel = responseMetadata?.model
                || this.invokerStrategy?.getLastInvocationDetails?.()?.model
                || model
                || 'auto';
            const loggedMode = responseMetadata?.mode || mode;
            logLLMInteraction({
                prompt,
                response: finalResponse,
                model: loggedModel,
                mode: loggedMode,
                durationMs: Date.now() - startedAt,
            });
            return finalResponse;
        } catch (error) {
            emit({
                phase: 'error',
                error: error?.message || String(error),
            });
            if (this._processingCallbacks?.onEnd) {
                try {
                    this._processingCallbacks.onEnd();
                } catch (callbackError) {
                    // Silently ignore callback errors
                }
            }
            const lastInvocation = this.invokerStrategy?.getLastInvocationDetails?.() || null;
            const loggedModel = lastInvocation?.model || responseMetadata?.model || model || 'auto';
            const loggedMode = lastInvocation?.mode || responseMetadata?.mode || mode;
            logLLMInteraction({
                prompt,
                response: error?.message || '',
                model: loggedModel,
                mode: loggedMode,
                durationMs: Date.now() - startedAt,
            });
            throw error;
        }
    }

    cancel() {
        try {
            cancelRequests();
        } catch {
            // ignore cancellation failures
        }
        if (this._processingCallbacks?.onEnd) {
            try {
                this._processingCallbacks.onEnd();
            } catch {
                // ignore callback errors
            }
        }
    }

    async executePrompt(promptText, options = {}) {
        if (!promptText || typeof promptText !== 'string') {
            throw new Error('executePrompt requires a promptText string.');
        }

        const {
            mode = 'fast',
            model = null,
            responseShape = null,
            globalMemory = null,
            userMemory = null,
            sessionMemory = null,
            skillShortMemory = null,
            ...rest
        } = options || {};

        const segments = [];
        const pushSegment = (label, value) => {
            if (value === null || value === undefined) {
                return;
            }
            try {
                const rendered = typeof value === 'string' ? value : value.toString();
                if (rendered && rendered.trim()) {
                    segments.push(`${label}:
${rendered.trim()}`);
                }
            } catch (error) {
                // ignore serialization issues
            }
        };

        pushSegment('Global Memory', globalMemory);
        pushSegment('User Memory', userMemory);
        pushSegment('Session Memory', sessionMemory);
        pushSegment('Skill Memory', skillShortMemory);

        const combinedContext = segments.length
            ? `${segments.join('\n\n')}

Prompt:
${promptText}`
            : promptText;

        const result = await this.doTask(combinedContext, promptText, {
            mode,
            model,
            ...rest,
        });

        if (!responseShape) {
            return result;
        }

        if (responseShape === 'json') {
            const parsed = extractJson(result);
            if (parsed === null) {
                throw new Error(`Expected JSON response but parsing failed. Raw: ${String(result).slice(0, 200)}…`);
            }
            return parsed;
        }

        if (responseShape === 'code') {
            return stripCodeFence(result);
        }

        if (responseShape === 'json-code') {
            try {
                const payload = JSON.parse(result);
                if (!payload || typeof payload !== 'object' || typeof payload.code !== 'string') {
                    throw new Error('missing "code" property');
                }
                payload.code = payload.code.trim();
                return payload;
            } catch (error) {
                throw new Error(`Expected JSON with code, but parsing failed: ${error.message}. Raw: ${String(result).slice(0, 200)}…`);
            }
        }

        return result;
    }

    async doTask(agentContext, description, options = {}) {
        return extraDoTask(this, agentContext, description, options);
    }

    async doTaskWithReview(agentContext, description, options = {}) {
        return extraDoTaskWithReview(this, agentContext, description, options);
    }

    async doTaskWithHumanReview(agentContext, description, options = {}) {
        return extraDoTaskWithHumanReview(this, agentContext, description, options);
    }

    async detectIntents(skillsDescription, userPrompt, options = {}) {
        const {
            mode = 'fast',
            model = null,
            ...rest
        } = options;

        const prompt = buildDetectIntentsPrompt(skillsDescription, userPrompt);

        const result = await this.complete({
            prompt,
            mode,
            model,
            context: { intent: 'detect-intents' },
            ...rest,
        });

        const parsed = extractJson(result);
        if (parsed === null) {
            throw new Error(`Failed to parse JSON from LLM response: ${result}`);
        }
        return parsed;
    }

    async startLoopAgentSession(tools, initialPrompt, options = {}) {
        if (!tools || typeof tools !== 'object') {
            throw new Error('startLoopAgentSession requires a tools object.');
        }
        if (!initialPrompt || typeof initialPrompt !== 'string') {
            throw new Error('startLoopAgentSession requires an initial prompt string.');
        }

        const session = new AgenticSession({
            agent: this,
            tools,
            options,
        });
        await session.newPrompt(initialPrompt);
        return session;
    }

    async startSOPLangAgentSession(skillsDescription, initialPrompt, options = {}) {
        if (!skillsDescription || typeof skillsDescription !== 'object') {
            throw new Error('startSOPLangAgentSession requires a skillsDescription object.');
        }
        if (!initialPrompt || typeof initialPrompt !== 'string') {
            throw new Error('startSOPLangAgentSession requires an initial prompt string.');
        }
 
        const {
            generatePlanOnly = false,
            planOnly = false,
            ...rest
        } = options || {};

        const sessionOptions = {
            ...rest,
            planOnly: planOnly || generatePlanOnly,
        };

        const session = new SOPAgenticSession({
            agent: this,
            skillsDescription,
            options: sessionOptions,
        });
        await session.newPrompt(initialPrompt);
        return session;
    }
}
 
export {
    LLMAgent,
    DEFAULT_AGENT_NAME,
};
