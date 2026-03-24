import {
    extractKeyValuePairs,
    extractIdeaList,
    classifyIntent,
    responseToJSON,
} from './markdown.mjs';
import { defaultLLMInvokerStrategy, cancelRequests } from '../utils/LLMClient.mjs';
import {
    buildInterpretMessagePrompt,
    buildDetectIntentsPrompt,
    buildResolveConfirmationPrompt,
    extractJson,
} from './templates/prompts.mjs';
import { LoopAgentSession } from './AgenticSession.mjs';
import { SOPAgenticSession } from './SOPAgenticSession.mjs';
import { stripCodeFence } from './LLMAgentHelpers.mjs';
import {
    extraComplete,
    extraDoTask,
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
        this._inputCounter = 0;
        this._outputCounter = 0;
        this._callLog = []; // Per-call tracking: { inputChars, outputChars, model, tier, durationMs, context }
        this._actionReporter = null;
        this._inputReader = null;
        this._outputWriter = null;
    }

    /**
     * Set an ActionReporter for real-time feedback
     * @param {ActionReporter} reporter - The reporter instance
     */
    setActionReporter(reporter) {
        this._actionReporter = reporter;
    }

    /**
     * Get the current ActionReporter
     * @returns {ActionReporter|null}
     */
    getActionReporter() {
        return this._actionReporter;
    }

    /**
     * Set an InputReader for reading user input.
     * InputReader should have: { read: async (prompt?) => string }
     * @param {object} reader - The input reader instance
     */
    setInputReader(reader) {
        this._inputReader = reader;
    }

    /**
     * Get the current InputReader
     * @returns {object|null} InputReader with read() method
     */
    get inputReader() {
        return this._inputReader;
    }

    /**
     * Set an OutputWriter for writing output to the user.
     * OutputWriter should have: { write: async (message) => void }
     * @param {object} writer - The output writer instance
     */
    setOutputWriter(writer) {
        this._outputWriter = writer;
    }

    /**
     * Get the current OutputWriter
     * @returns {object|null} OutputWriter with write() method
     */
    get outputWriter() {
        return this._outputWriter;
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
            tier: 'fast',
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

    async resolveConfirmation(userInput, { actionContext = null, tier = 'fast' } = {}) {
        if (!userInput || typeof userInput !== 'string') {
            return { decision: 'unclear', confidence: 0 };
        }

        const trimmed = userInput.trim().toLowerCase();
        if (!trimmed) {
            return { decision: 'unclear', confidence: 0 };
        }

        // Fast path: check common explicit responses first
        const yesPatterns = ['yes', 'y', 'ok', 'sure', 'confirm', 'accept', 'proceed'];
        const noPatterns = ['no', 'n', 'cancel', 'stop', 'abort', 'reject'];

        if (yesPatterns.includes(trimmed)) {
            return { decision: 'yes', confidence: 1.0 };
        }
        if (noPatterns.includes(trimmed)) {
            return { decision: 'no', confidence: 1.0 };
        }

        // Use LLM for ambiguous input
        const prompt = buildResolveConfirmationPrompt(userInput, actionContext);

        try {
            const response = await this.complete({
                prompt,
                tier,
                context: { intent: 'resolve-confirmation' },
            });

            const parsed = extractJson(response);
            if (parsed && typeof parsed.decision === 'string') {
                const decision = parsed.decision.toLowerCase();
                const confidence = typeof parsed.confidence === 'number'
                    ? Math.max(0, Math.min(1, parsed.confidence))
                    : 0.7;

                if (['yes', 'no', 'unclear'].includes(decision)) {
                    return { decision, confidence };
                }
            }
        } catch (error) {
            // Fall through to unclear on error
        }

        return { decision: 'unclear', confidence: 0 };
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

    getSupportedTiers() {
        return this.getSupportedModes();
    }

    getInputCounter() {
        return this._inputCounter;
    }

    getOutputCounter() {
        return this._outputCounter;
    }

    /**
     * Get per-call log entries.
     * Each entry: { inputChars, outputChars, model, tier, durationMs, intent }
     * @returns {Array}
     */
    getCallLog() {
        return this._callLog;
    }

    _recordInputChars(count = 0) {
        const safe = Number.isFinite(count) ? count : 0;
        this._inputCounter += Math.max(0, safe);
    }

    _recordOutputChars(count = 0) {
        const safe = Number.isFinite(count) ? count : 0;
        this._outputCounter += Math.max(0, safe);
    }

    async complete(options = {}) {
        return extraComplete(this, options);
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
            tier = 'fast',
            mode = null,
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

        const agentContext = segments.length
            ? `${segments.join('\n\n')}

Prompt:
${promptText}`
            : '';

        const result = await extraDoTask(this, agentContext, promptText, {
            tier,
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
            // Use extractJson to handle potential markdown code fences
            const payload = extractJson(result);
            if (!payload || typeof payload !== 'object') {
                throw new Error(`Expected JSON with code, but parsing failed. Raw: ${String(result).slice(0, 200)}…`);
            }
            if (typeof payload.code !== 'string') {
                throw new Error('missing "code" property in JSON response');
            }
            payload.code = payload.code.trim();
            return payload;
        }

        return result;
    }

    async detectIntents(skillsDescription, userPrompt, options = {}) {
        const {
            tier = null,
            model = null,
            ...rest
        } = options;

        const prompt = buildDetectIntentsPrompt(skillsDescription, userPrompt);

        const result = await this.complete({
            prompt,
            tier: tier ?? undefined,
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

        const { initialExpected = null, ...sessionOptions } = options || {};

        const session = new LoopAgentSession({
            agent: this,
            tools,
            options: sessionOptions,
        });
        await session.newPrompt(initialPrompt, { expected: initialExpected });
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
