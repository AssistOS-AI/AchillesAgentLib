import { buildAgenticSessionPlannerPrompt, extractJson } from './templates/prompts.mjs';
import {
    FINAL_ANSWER_TOOL,
    FINAL_ANSWER_DESCRIPTION,
    CANNOT_COMPLETE_TOOL,
    CANNOT_COMPLETE_DESCRIPTION,
    normalizeResponsePayload,
} from './constants.mjs';

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
            mode: options.mode || 'fast',
            model: options.model || null,
            maxRetriesPerTurn: Number.isFinite(options.maxRetriesPerTurn)
                ? options.maxRetriesPerTurn
                : 3,
        };

        this.turns = [];
        this.history = [];
        this.toolCalls = [];
        this.errorCount = 0;
        this.status = 'idle';
        this.lastAnswer = null;
        this.systemPrompt = typeof options.systemPrompt === 'string' ? options.systemPrompt : '';
        this.failedTurns = [];
    }

    async newPrompt(userPrompt, options = {}) {
        if (!userPrompt || typeof userPrompt !== 'string') {
            throw new Error('newPrompt requires a prompt string.');
        }
        const expected = typeof options.expected === 'string' || typeof options.expected === 'number'
            ? String(options.expected)
            : null;
        const maxRetries = Number.isFinite(options.maxRetries)
            ? options.maxRetries
            : this.options.maxRetriesPerTurn;

        // Session-level logging for incoming prompts
        // eslint-disable-next-line no-console
        console.log(`[AgenticSession] New prompt: "${userPrompt}"`);

        const turn = {
            prompt: userPrompt,
            steps: [],
            finalAnswer: null,
            status: 'running',
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
        this.status = 'running';

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


    async _runLoopForPrompt(userPrompt, turn) {
        const { maxStepsPerTurn, maxErrors } = this.options;

        for (let stepIndex = 0; stepIndex < maxStepsPerTurn; stepIndex += 1) {
            const decision = await this._requestDecision(userPrompt, turn, stepIndex);
            turn.steps.push({ type: 'planner_decision', decision });

            const action = (decision && decision.action) || null;

            if (action === 'call_tool') {
                const toolName = decision.tool;
                const toolPrompt = decision.toolPrompt || userPrompt;

                try {
                    const toolResult = await this._executeTool(toolName, toolPrompt, turn);
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
                            turn.finalAnswer = final;
                            turn.status = 'failed';
                            this.status = 'failed';
                            this.lastAnswer = final;
                            this.failedTurns.push(turn);
                            this.history.push({ type: 'cannot_complete', answer: final });
                            return final;
                        }

                        if (matchesExpected) {
                            turn.finalAnswer = final;
                            turn.status = 'done';
                            this.status = 'active';
                            this.lastAnswer = final;
                            this.history.push({ type: 'final_answer', answer: final });
                            return final;
                        }

                        // Validation failed: record and retry if allowed
                        turn.retryCount += 1;
                        this.history.push({
                            type: 'validation_failed',
                            expected,
                            actual: final,
                            retryCount: turn.retryCount,
                        });
                        if (turn.retryCount >= turn.maxRetries) {
                            turn.finalAnswer = final;
                            turn.status = 'failed';
                            this.status = 'active';
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
                        turn.finalAnswer = final;
                        turn.status = 'done';
                        this.status = 'active';
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
                    console.error(`[AgenticSession] Tool "${toolName}" failed with prompt "${toolPrompt}":`, error.message);

                    if (this.errorCount >= maxErrors) {
                        const message = 'Too many tool errors, aborting.';
                        turn.finalAnswer = message;
                        turn.status = 'failed';
                        this.status = 'failed';
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
                if (this.errorCount >= maxErrors) {
                    const message = 'Too many planner errors, aborting.';
                    turn.finalAnswer = message;
                    turn.status = 'failed';
                    this.status = 'failed';
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
            if (this.errorCount >= maxErrors) {
                const message = 'Too many planner errors, aborting.';
                turn.finalAnswer = message;
                turn.status = 'failed';
                this.status = 'failed';
                return message;
            }
        }

        const fallback = 'Unable to complete within step limit.';
        turn.finalAnswer = fallback;
        turn.status = 'failed';
        this.status = 'failed';
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
        });

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

        let parsed = null;
        try {
            if (typeof raw === 'object' && raw !== null) {
                parsed = raw;
            } else {
                parsed = extractJson(raw);
            }
        } catch (error) {
            parsed = null;
        }

        if (!parsed || typeof parsed !== 'object') {
            throw new Error('Planner did not return a valid JSON object.');
        }

        return parsed;
    }

    async _executeTool(toolName, toolPrompt) {
        const toolEntry = this.tools[toolName];
        if (!toolEntry || typeof toolEntry.handler !== 'function') {
            throw new Error(`Unknown tool: ${toolName}`);
        }

        // eslint-disable-next-line no-console
        console.log(`[AgenticSession] Calling tool "${toolName}" with prompt: "${toolPrompt}"`);

        // Attach session to agent temporarily to support tools that need session context
        this.agent.currentSession = this;
        let result;
        try {
            result = await toolEntry.handler(this.agent, toolPrompt);
        } finally {
            this.agent.currentSession = null;
        }

        this.toolCalls.push({
            tool: toolName,
            prompt: toolPrompt,
            result: result && (result.__finalAnswer || result.__cannotComplete) ? result.text : result,
        });
        this.history.push({
            type: 'tool',
            tool: toolName,
            prompt: toolPrompt,
            result,
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
