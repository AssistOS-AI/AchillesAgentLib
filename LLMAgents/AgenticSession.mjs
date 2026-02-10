import { buildAgenticSessionPlannerPrompt, extractJson } from './templates/prompts.mjs';
import { getDebugLogger, DEBUG_ACTIVE } from '../utils/DebugLogger.mjs';
//import { appendAgenticAudit } from '../utils/AgenticSessionLogger.mjs';
import {
    FINAL_ANSWER_TOOL,
    FINAL_ANSWER_DESCRIPTION,
    CANNOT_COMPLETE_TOOL,
    CANNOT_COMPLETE_DESCRIPTION,
    SESSION_STATUS_IDLE,
    SESSION_STATUS_RUNNING,
    SESSION_STATUS_ACTIVE,
    SESSION_STATUS_AWAITING_INPUT,
    SESSION_STATUS_DONE,
    SESSION_STATUS_FAILED,
    normalizeResponsePayload,
} from './constants.mjs';

const DEBUG_ENABLED = String(process.env.ACHILLES_DEBUG ?? process.env.ACHILES_DEBUG ?? '').toLowerCase() === 'true';

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

// Timestamp helper for logging
const getTimestamp = () => {
    const now = new Date();
    return now.toISOString().slice(11, 23); // HH:MM:SS.mmm
};

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

function buildContextPieceLines(entries = []) {
    return entries.map((entry, index) => {
        const safeValue = String(entry.value ?? '').replace(/"/g, '\\"');
        return `@context-piece-${index + 1} := "${safeValue}"`;
    });
}

function buildPreparationPrompt(preparationText, userPrompt) {
    const preparation = String(preparationText || '').trim();
    if (!preparation) {
        return '';
    }
    const requestText = String(userPrompt || '').trim();
    const parts = [
        'Preparation instructions:',
        preparation,
        '',
    ];
    if (requestText) {
        parts.push('User request:');
        parts.push(requestText);
        parts.push('');
    }
    parts.push('Based on the preparation instructions, output only lines in the format:');
    parts.push('@context_key := "value"');
    parts.push('Do not include any extra text.');
    return parts.join('\n');
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

class LoopAgentSession {
    constructor({ agent, tools, options = {} }) {
        if (!agent) {
            throw new Error('LoopAgentSession requires an LLMAgent instance.');
        }
        if (!tools || typeof tools !== 'object') {
            throw new Error('LoopAgentSession requires a tools object.');
        }
        [FINAL_ANSWER_TOOL, CANNOT_COMPLETE_TOOL].forEach((reserved) => {
            if (Object.prototype.hasOwnProperty.call(tools, reserved)) {
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
        this._userTools = { ...tools };
        this.tools = {
            ...tools,
            [FINAL_ANSWER_TOOL]: this._buildFinalAnswerTool(),
            [CANNOT_COMPLETE_TOOL]: this._buildCannotCompleteTool(),
        };
        this.options = {
            maxStepsPerTurn: Number.isFinite(options.maxStepsPerTurn)
                ? options.maxStepsPerTurn
                : 8,
            maxErrors: Number.isFinite(options.maxErrors) ? options.maxErrors : 5,
            mode: options.mode || 'deep',
            model: options.model || null,
            maxRetriesPerTurn: Number.isFinite(options.maxRetriesPerTurn)
                ? options.maxRetriesPerTurn
                : 3,
        };

        this.turns = [];
        this.history = [];
        this.toolCalls = [];
        this.errorCount = 0;
        this.status = SESSION_STATUS_IDLE;
        this.lastAnswer = null;
        this.systemPrompt = typeof options.systemPrompt === 'string' ? options.systemPrompt : '';
        this.baseSystemPrompt = this.systemPrompt;
        this.preparation = options.preparation || null;
        this.failedTurns = [];
        this.toolVars = new Map();
        this.toolVarCounter = 0;
        this.debugLogger = DEBUG_ACTIVE ? getDebugLogger() : null;
    }

    _debug(...args) {
        if (this.debugLogger) {
            this.debugLogger.log(...args);
        }
    }

    async newPrompt(userPrompt, options = {}) {
        if (!userPrompt || typeof userPrompt !== 'string') {
            throw new Error('newPrompt requires a prompt string.');
        }

        // Run preparation if configured
        if (this.preparation?.text) {
            const prepResult = await LoopAgentSession.runPreparation({
                agent: this.agent,
                tools: this._userTools,
                options: { mode: this.options.mode, maxStepsPerTurn: this.options.maxStepsPerTurn },
                preparationText: this.preparation.text,
                userPrompt,
                retries: this.preparation.retries ?? 1,
            });
            const contextLines = prepResult?.contextLines || [];
            this.systemPrompt = injectContextIntoPrompt(this.baseSystemPrompt, contextLines);
            userPrompt = injectContextIntoPrompt(userPrompt, contextLines);
        }

        const expected = typeof options.expected === 'string' || typeof options.expected === 'number'
            ? String(options.expected)
            : null;
        const maxRetries = Number.isFinite(options.maxRetries)
            ? options.maxRetries
            : this.options.maxRetriesPerTurn;

        // Session-level logging for incoming prompts
        debugLog(`[${getTimestamp()}] [LoopSession] New prompt: "${userPrompt}"`);
        this._debug('[LoopSession]', 'New prompt', { prompt: userPrompt, expected });

        const turn = {
            prompt: userPrompt,
            steps: [],
            finalAnswer: null,
            status: SESSION_STATUS_RUNNING,
            usedTools: false,
            _lastToolName: null,
            _lastToolPrompt: null,
            _lastToolResult: null,
            _sameToolRepeatCount: 0,
            expected,
            retryCount: 0,
            maxRetries,
            failed: false,
        };
        this.turns.push(turn);
        this.history.push({ type: 'user', prompt: userPrompt });
        this.status = SESSION_STATUS_RUNNING;

        const answer = await this._runLoopForPrompt(userPrompt, turn);
        this.lastAnswer = answer;
 
        const invariantAnswer = this.getLastResult();
        if (invariantAnswer !== this.lastAnswer) {
            throw new Error('LoopAgentSession invariant violated: getLastResult() mismatch with lastAnswer.');
        }
 
        return answer;
    }
 
    getLastResult() {
        return this.lastAnswer;
    }
 
    async getVariables() {
        return {
            lastAnswer: this.getLastResult(),
            status: this.status,
            failedTurns: this.failedTurns.length,
        };
    }
    
    hasFailedTurns() {
        return this.failedTurns.length > 0;
    }

    async finalizeFailures() {
        if (!this.hasFailedTurns()) {
            return null;
        }
        try {
            return await this._executeTool(CANNOT_COMPLETE_TOOL, 'One or more steps failed validation.');
        } catch {
            return null;
        }
    }

    static async runPreparation({
        agent,
        tools,
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

        const attemptRun = async () => {
            const sessionOptions = {
                ...options,
                systemPrompt: 'Execute skills to prepare context for the user request.',
            };
            const session = new LoopAgentSession({
                agent,
                tools,
                options: sessionOptions,
            });
            await session.newPrompt(preparationPrompt);
            if (session.status === SESSION_STATUS_AWAITING_INPUT) {
                throw new Error('Preparation loop requires user input.');
            }
            const resultText = coerceResultToText(session.getLastResult());
            const contextEntries = parseContextVariables(resultText, contextPrefix);
            const contextLines = buildContextPieceLines(contextEntries);
            return { contextEntries, contextLines, rawText: resultText };
        };

        return runWithRetry(attemptRun, retries);
    }


    async _runLoopForPrompt(userPrompt, turn) {
        const { maxStepsPerTurn, maxErrors } = this.options;
        this._debug('[LoopSession]', 'Run loop start', {
            prompt: userPrompt,
            maxStepsPerTurn,
            maxErrors,
            mode: this.options.mode,
        });

        for (let stepIndex = 0; stepIndex < maxStepsPerTurn; stepIndex += 1) {
            const decision = await this._requestDecision(userPrompt, turn, stepIndex);
            turn.steps.push({ type: 'planner_decision', decision });
            this._debug('[LoopSession]', 'Planner decision', { stepIndex, decision });

            const action = (decision && decision.action) || null;

            if (action === 'call_tool') {
                const toolName = decision.tool;
                const toolPrompt = decision.toolPrompt || userPrompt;

                this.history.push({
                    type: 'tool_call',
                    tool: toolName,
                    prompt: toolPrompt,
                });

                try {
                    const toolResult = await this._executeTool(toolName, toolPrompt, turn);
                    // Debug: log tool result type and key properties
                    debugLog(`[${getTimestamp()}] [LoopSession] Tool "${toolName}" returned: type=${typeof toolResult}, requiresConfirmation=${toolResult?.requiresConfirmation}, requiresInput=${toolResult?.requiresInput}`);
                    this._debug('[LoopSession]', 'Tool result', {
                        tool: toolName,
                        prompt: toolPrompt,
                        type: typeof toolResult,
                        requiresConfirmation: toolResult?.requiresConfirmation,
                        requiresInput: toolResult?.requiresInput,
                    });
                    const displayResult = toolResult && (toolResult.__finalAnswer || toolResult.__cannotComplete)
                        ? toolResult.text
                        : toolResult;
                    turn.usedTools = true;
                    turn.steps.push({
                        type: 'tool_result',
                        tool: toolName,
                        prompt: toolPrompt,
                        result: displayResult,
                    });

                    // Handle interactive tools that require user confirmation or input
                    // When a tool returns requiresConfirmation or requiresInput, stop and return to user
                    if (toolResult && typeof toolResult === 'object' && 
                        (toolResult.requiresConfirmation || toolResult.requiresInput)) {
                        const message = toolResult.message || JSON.stringify(toolResult);
                        debugLog(`[${getTimestamp()}] [LoopSession] Detected requiresConfirmation/Input, returning message (first 100 chars): "${String(message).substring(0, 100)}..."`);
                        this._debug('[LoopSession]', 'Tool requires input/confirmation', { tool: toolName, message });
                        turn.finalAnswer = message;
                        turn.status = SESSION_STATUS_AWAITING_INPUT;
                        this.status = SESSION_STATUS_AWAITING_INPUT;
                        this.lastAnswer = message;
                        this.history.push({ 
                            type: SESSION_STATUS_AWAITING_INPUT, 
                            answer: message,
                            tool: toolName,
                            step: toolResult.step || null
                        });
                        return message;
                    }

                    // Handle successful database/skill results that should be returned immediately
                    // When a tool returns success:true with records or a message, treat as final answer
                    if (toolResult && typeof toolResult === 'object' && 
                        toolResult.success === true && 
                        (toolResult.records || toolResult.message || toolResult.operation)) {
                        // This is a successful skill result - return it as final answer
                        const resultStr = JSON.stringify(toolResult);
                        debugLog(`[${getTimestamp()}] [LoopSession] Detected successful skill result, returning as final answer`);
                        this._debug('[LoopSession]', 'Tool success result returned as final answer', { tool: toolName });
                        turn.finalAnswer = resultStr;
                        turn.status = SESSION_STATUS_DONE;
                        this.status = SESSION_STATUS_ACTIVE;
                        this.lastAnswer = resultStr;
                        this.history.push({ type: 'final_answer', answer: resultStr });
                        return resultStr;
                    }

                    // Detect true loops: same tool + same prompt + same result
                    // Different prompts with same results are NOT loops (e.g., createDirectory for different paths)
                    if (turn._lastToolName === toolName
                        && turn._lastToolPrompt === toolPrompt
                        && String(turn._lastToolResult) === String(displayResult)) {
                        turn._sameToolRepeatCount = (turn._sameToolRepeatCount || 1) + 1;
                    } else {
                        turn._lastToolName = toolName;
                        turn._lastToolPrompt = toolPrompt;
                        turn._lastToolResult = displayResult;
                        turn._sameToolRepeatCount = 1;
                    }

                    if (toolResult && (toolResult.__finalAnswer || toolResult.__cannotComplete)) {
                        const final = toolResult.text;
                        const expected = turn.expected;
                        const normalize = (v) => String(v ?? '').trim().toLowerCase();
                        const matchesExpected = expected === null
                            ? true
                            : normalize(final) === normalize(expected);

                        if (toolResult.__cannotComplete) {
                            this._debug('[LoopSession]', 'Tool cannot complete', { tool: toolName, final });
                            turn.finalAnswer = final;
                            turn.status = SESSION_STATUS_FAILED;
                            this.status = SESSION_STATUS_FAILED;
                            this.lastAnswer = final;
                            this.failedTurns.push(turn);
                            this.history.push({ type: 'cannot_complete', answer: final });
                            return final;
                        }

                        if (matchesExpected) {
                            this._debug('[LoopSession]', 'Tool final answer accepted', { tool: toolName, final });
                            turn.finalAnswer = final;
                            turn.status = SESSION_STATUS_DONE;
                            this.status = SESSION_STATUS_ACTIVE;
                            this.lastAnswer = final;
                            this.history.push({ type: 'final_answer', answer: final });
                            return final;
                        }

                        // Validation failed: record and retry if allowed
                        this._debug('[LoopSession]', 'Validation failed', {
                            tool: toolName,
                            expected,
                            actual: final,
                            retryCount: turn.retryCount + 1,
                        });
                        turn.retryCount += 1;
                        this.history.push({
                            type: 'validation_failed',
                            expected,
                            actual: final,
                            retryCount: turn.retryCount,
                        });
                        if (turn.retryCount >= turn.maxRetries) {
                            turn.finalAnswer = final;
                            turn.status = SESSION_STATUS_FAILED;
                            this.status = SESSION_STATUS_ACTIVE;
                            this.lastAnswer = final;
                            this.failedTurns.push(turn);
                            this.history.push({ type: 'final_answer', answer: final, validationFailed: true });
                            return final;
                        }
                        // Retry by continuing the loop
                        continue;
                    }

                    if (turn._sameToolRepeatCount >= 3) {
                        const final = String(displayResult);
                        this._debug('[LoopSession]', 'Repeat tool result threshold reached', {
                            tool: toolName,
                            prompt: toolPrompt,
                        });
                        turn.finalAnswer = final;
                        turn.status = SESSION_STATUS_DONE;
                        this.status = SESSION_STATUS_ACTIVE;
                        this.history.push({ type: 'final_answer', answer: final });
                        return final;
                    }
                } catch (error) {
                    this.errorCount += 1;
                    turn.steps.push({
                        type: 'tool_error',
                        tool: toolName,
                        prompt: toolPrompt,
                        error: error.message,
                    });
                    console.error(`[${getTimestamp()}] [LoopSession] Tool "${toolName}" failed with prompt "${toolPrompt}":`, error.message);
                    this._debug('[LoopSession]', 'Tool error', {
                        tool: toolName,
                        prompt: toolPrompt,
                        error: error.message,
                        errorCount: this.errorCount,
                        maxErrors,
                    });

                    if (this.errorCount >= maxErrors) {
                        const message = 'Too many tool errors, aborting.';
                        this._debug('[LoopSession]', 'Aborting due to tool errors', { message });
                        turn.finalAnswer = message;
                        turn.status = SESSION_STATUS_FAILED;
                        this.status = SESSION_STATUS_FAILED;
                        return message;
                    }
                }
                // eslint-disable-next-line no-continue
                continue;
            }

            if (action === 'final_answer' || action === 'cannot_complete') {
                this.errorCount += 1;
                turn.steps.push({
                    type: 'tool_error',
                    error: 'Use the reserved tools final_answer or cannot_complete via call_tool to end the turn.',
                });
                this._debug('[LoopSession]', 'Planner used invalid action', {
                    action,
                    errorCount: this.errorCount,
                });
                if (this.errorCount >= maxErrors) {
                    const message = 'Too many planner errors, aborting.';
                    this._debug('[LoopSession]', 'Aborting due to planner errors', { message });
                    turn.finalAnswer = message;
                    turn.status = SESSION_STATUS_FAILED;
                    this.status = SESSION_STATUS_FAILED;
                    return message;
                }
                // eslint-disable-next-line no-continue
                continue;
            }

            this.errorCount += 1;
            turn.steps.push({
                type: 'planner_error',
                error: 'Invalid or missing action in planner response.',
            });
            this._debug('[LoopSession]', 'Planner error: invalid or missing action', {
                errorCount: this.errorCount,
            });
            if (this.errorCount >= maxErrors) {
                const message = 'Too many planner errors, aborting.';
                this._debug('[LoopSession]', 'Aborting due to planner errors', { message });
                turn.finalAnswer = message;
                turn.status = SESSION_STATUS_FAILED;
                this.status = SESSION_STATUS_FAILED;
                return message;
            }
        }

        const fallback = 'Unable to complete within step limit.';
        this._debug('[LoopSession]', 'Step limit reached', { message: fallback });
        turn.finalAnswer = fallback;
        turn.status = SESSION_STATUS_FAILED;
        this.status = SESSION_STATUS_FAILED;
        this.history.push({ type: 'timeout', message: fallback });
        this.failedTurns.push(turn);
        return fallback;
    }

    async _requestDecision(userPrompt, turn, stepIndex) {
        const plannerPrompt = buildAgenticSessionPlannerPrompt({
            tools: this.tools,
            history: this.history,
            toolCalls: this.toolCalls,
            userPrompt,
            systemPrompt: this.systemPrompt,
            toolVars: this.toolVars,
        });

        this._debug('[LoopSession]', 'Planner prompt built', {
            stepIndex,
            promptLength: plannerPrompt.length,
        });

        // await appendAgenticAudit({
        //     prompt: plannerPrompt,
        // });

        const raw = await this.agent.complete({
            prompt: plannerPrompt,
            mode: this.options.mode,
            model: this.options.model,
            context: {
                intent: 'agentic-session-planner',
                stepIndex,
                userPrompt,
            },
        });

        this._debug('[LoopSession]', 'Planner raw response', {
            stepIndex,
            raw: typeof raw === 'string' ? raw.slice(0, 2000) : raw,
        });

        let parsed = null;
        try {
            if (typeof raw === 'object' && raw !== null) {
                parsed = raw;
            } else {
                parsed = extractJson(raw);
            }
        } catch (error) {
            parsed = null;
            this._debug('[LoopSession]', 'Planner JSON parse error', {
                stepIndex,
                error: error.message,
            });
        }

        if (!parsed || typeof parsed !== 'object') {
            this._debug('[LoopSession]', 'Planner returned invalid response', {
                stepIndex,
                parsed,
            });
            throw new Error('Planner did not return a valid JSON object.');
        }

        this._debug('[LoopSession]', 'Planner parsed response', { stepIndex, parsed });

        return parsed;
    }

    async _executeTool(toolName, toolPrompt) {
        const toolEntry = this.tools[toolName];
        if (!toolEntry || typeof toolEntry.handler !== 'function') {
            throw new Error(`Unknown tool: ${toolName}`);
        }

        const resolvedPrompt = typeof toolPrompt === 'string'
            ? toolPrompt.replace(/\$\$([A-Za-z0-9_-]+)/g, (match, resultRef) => {
                if (!this.toolVars.has(resultRef)) {
                    throw new Error(`Unknown tool variable: ${resultRef}`);
                }
                const value = this.toolVars.get(resultRef);
                return typeof value === 'string' ? value : JSON.stringify(value);
            })
            : toolPrompt;

        debugLog(`[${getTimestamp()}] [LoopSession] Calling tool "${toolName}" with prompt: "${resolvedPrompt}"`);
        this._debug('[LoopSession]', 'Calling tool', { tool: toolName, prompt: resolvedPrompt });

        // Attach session to agent temporarily to support tools that need session context
        this.agent.currentSession = this;
        let result;
        try {
            result = await toolEntry.handler(this.agent, resolvedPrompt);
        } finally {
            this.agent.currentSession = null;
        }

        this.toolVarCounter += 1;
        const resultRef = `${toolName}-res-${this.toolVarCounter}`;
        const storedValue = result && (result.__finalAnswer || result.__cannotComplete)
            ? result.text
            : result;
        this.toolVars.set(resultRef, storedValue);

        this.toolCalls.push({
            tool: toolName,
            prompt: toolPrompt,
            result: result && (result.__finalAnswer || result.__cannotComplete) ? result.text : result,
            resultRef,
        });
        this.history.push({
            type: 'tool',
            tool: toolName,
            prompt: toolPrompt,
            result: {
                resultRef,
            },
        });

        return result;
    }

    _buildFinalAnswerTool() {
        return {
            description: FINAL_ANSWER_DESCRIPTION,
            handler: async (_agent, payload) => {
                const text = normalizeResponsePayload(payload);
                this.lastAnswer = text;
                return {
                    __finalAnswer: true,
                    text,
                };
            },
        };
    }

    _buildCannotCompleteTool() {
        return {
            description: CANNOT_COMPLETE_DESCRIPTION,
            handler: async (_agent, payload) => {
                const text = normalizeResponsePayload(payload, 'Agent cannot complete the task.');
                this.lastAnswer = text;
                return {
                    __cannotComplete: true,
                    text,
                };
            },
        };
    }
}

export {
    LoopAgentSession,
};
