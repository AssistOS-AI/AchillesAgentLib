import { buildAgenticSessionPlannerPrompt, extractJson } from './templates/prompts.mjs';
import {
    RETURN_RESPONSE_TOOL,
    RETURN_RESPONSE_DESCRIPTION,
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
        if (Object.prototype.hasOwnProperty.call(tools, RETURN_RESPONSE_TOOL)) {
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
        this.tools = {
            ...tools,
            [RETURN_RESPONSE_TOOL]: this._buildReturnResponseTool(),
        };
        this.options = {
            maxStepsPerTurn: Number.isFinite(options.maxStepsPerTurn)
                ? options.maxStepsPerTurn
                : 8,
            maxErrors: Number.isFinite(options.maxErrors) ? options.maxErrors : 5,
            mode: options.mode || 'fast',
            model: options.model || null,
        };

        this.turns = [];
        this.history = [];
        this.toolCalls = [];
        this.errorCount = 0;
        this.status = 'idle';
        this.lastAnswer = null;
        this._pendingReturnResponse = null;
    }

    async newPrompt(userPrompt) {
        if (!userPrompt || typeof userPrompt !== 'string') {
            throw new Error('newPrompt requires a prompt string.');
        }

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
            _lastToolResult: null,
            _sameToolRepeatCount: 0,
        };
        this.turns.push(turn);
        this.history.push({ type: 'user', prompt: userPrompt });
        this.status = 'running';

        const answer = await this._runLoopForPrompt(userPrompt, turn);
        this.lastAnswer = answer;
        return answer;
    }

    getLastResult() {
        return this.lastAnswer;
    }

    async getVariables() {
        return {
            lastAnswer: this.lastAnswer,
            status: this.status,
        };
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
                    const displayResult = toolResult && toolResult.__returnResponse
                        ? toolResult.text
                        : toolResult;
                    turn.usedTools = true;
                    turn.steps.push({
                        type: 'tool_result',
                        tool: toolName,
                        prompt: toolPrompt,
                        result: displayResult,
                    });

                    if (turn._lastToolName === toolName
                        && String(turn._lastToolResult) === String(displayResult)) {
                        turn._sameToolRepeatCount = (turn._sameToolRepeatCount || 1) + 1;
                    } else {
                        turn._lastToolName = toolName;
                        turn._lastToolResult = displayResult;
                        turn._sameToolRepeatCount = 1;
                    }

                    if (toolResult && toolResult.__returnResponse) {
                        const final = toolResult.text;
                        turn.finalAnswer = final;
                        turn.status = 'done';
                        this.status = 'active';
                        this.lastAnswer = final;
                        this.history.push({ type: 'final_answer', answer: final });
                        return final;
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

            if (action === 'final_answer') {
                const hasTools = this.tools && Object.keys(this.tools).length > 0;
                const toolNames = hasTools ? Object.keys(this.tools) : [];
                const userMentionsTool = toolNames.some((name) => (
                    typeof userPrompt === 'string'
                    && userPrompt.toLowerCase().includes(name.toLowerCase())
                ));

                if (userMentionsTool && !turn.usedTools) {
                    this.errorCount += 1;
                    turn.steps.push({
                        type: 'planner_error',
                        error: 'final_answer requested without using the explicitly mentioned tool',
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

                const answer = (decision && decision.answer) || '';
                turn.finalAnswer = answer;
                this.lastAnswer = answer;
                turn.status = 'done';
                this.status = 'active';
                this.history.push({ type: 'final_answer', answer });
                return answer;
            }

            if (action === 'cannot_complete') {
                const answer = (decision && (decision.answer || decision.reason))
                    || 'Agent cannot complete the task.';
                turn.finalAnswer = answer;
                turn.status = 'failed';
                this.status = 'failed';
                this.history.push({ type: 'cannot_complete', answer });
                return answer;
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
        return fallback;
    }

    async _requestDecision(userPrompt, turn, stepIndex) {
        const plannerPrompt = buildAgenticSessionPlannerPrompt({
            tools: this.tools,
            history: this.history,
            toolCalls: this.toolCalls,
            userPrompt,
        });

        const raw = await this.agent.complete({
            prompt: plannerPrompt,
            mode: this.options.mode,
            model: this.options.model,
            context: {
                intent: 'agentic-session-planner',
                stepIndex,
            },
        });

        let parsed = null;
        try {
            parsed = extractJson(raw);
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
            result: result && result.__returnResponse ? result.text : result,
        });
        this.history.push({
            type: 'tool',
            tool: toolName,
            prompt: toolPrompt,
            result,
        });

        return result;
    }

    _buildReturnResponseTool() {
        return {
            description: RETURN_RESPONSE_DESCRIPTION,
            handler: async (_agent, payload) => {
                const text = normalizeResponsePayload(payload);
                this.lastAnswer = text;
                return {
                    __returnResponse: true,
                    text,
                };
            },
        };
    }
}

export {
    LoopAgentSession,
};
