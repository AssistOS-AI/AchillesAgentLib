import { buildAgenticSessionPlannerPrompt, buildPreparationPrompt, extractJson } from './templates/prompts.mjs';
import { getDebugLogger, DEBUG_ACTIVE } from '../utils/DebugLogger.mjs';
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

function formatLogValue(value) {
    if (value === null || value === undefined) {
        return '';
    }
    if (typeof value === 'string') {
        return value;
    }
    try {
        return JSON.stringify(value);
    } catch (error) {
        return String(value);
    }
}

function coerceStructuredToolResult(value) {
    if (!value || typeof value !== 'string') {
        return value;
    }
    const parsed = extractJson(value);
    if (parsed && typeof parsed === 'object') {
        return parsed;
    }
    return value;
}

function getPendingAwaitingInputTool(history = []) {
    for (let i = history.length - 1; i >= 0; i -= 1) {
        const entry = history[i];
        if (entry?.type === SESSION_STATUS_AWAITING_INPUT && typeof entry.tool === 'string' && entry.tool.trim()) {
            return entry.tool.trim();
        }
        if (entry?.type === 'final_answer' || entry?.type === 'cannot_complete') {
            break;
        }
    }
    return null;
}

function buildPendingInputDecision(toolName, userPrompt) {
    return {
        tool: toolName,
        toolPrompt: userPrompt,
        routeReason: 'pending_awaiting_input',
    };
}

function isLikelyFreshInstruction(prompt = '') {
    const text = String(prompt || '').trim();
    if (!text) return false;
    return /^(list|show|display|view|get|find|search|add|create|new|update|edit|change|delete|remove|import|wipe|help|exit|quit|start|stop)\b/i.test(text);
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

const MOVEMENT_INTENT_PATTERN = /\b(move|relocate|transfer|assign|muta|mută|transfera)\b/i;
const DESTINATION_AREA_PATTERN = /\b(to|into|in|la|catre|către)\s+area\b/i;
const MATERIAL_CUE_PATTERN = /\b(material|materials|conduit|cms|cable|consumable|fixing|crms|supply|supplies)\b/i;
const EQUIPMENT_CUE_PATTERN = /\b(equipment|equipments|tool|tools|device|devices|asset|assets|instrument|instruments)\b/i;
const AREA_EDIT_PATTERN = /\b(area\s+(name|location|description|type)|rename\s+area|update\s+area|edit\s+area|modify\s+area|create\s+area|delete\s+area|list\s+areas|show\s+areas)\b/i;

function inferMovementTargetTool(promptText = '', tools = {}) {
    const hasMaterialTool = Object.prototype.hasOwnProperty.call(tools, 'material');
    const hasEquipmentTool = Object.prototype.hasOwnProperty.call(tools, 'equipment');
    const text = String(promptText || '');
    const hasMaterialCue = MATERIAL_CUE_PATTERN.test(text);
    const hasEquipmentCue = EQUIPMENT_CUE_PATTERN.test(text);

    if (hasMaterialCue && hasMaterialTool) {
        return 'material';
    }
    if (hasEquipmentCue && hasEquipmentTool) {
        return 'equipment';
    }
    return null;
}

function validateAndRepairPlannerDecision(decision, userPrompt, tools = {}) {
    if (!decision || typeof decision !== 'object') {
        return { decision, adjusted: false };
    }

    if (typeof decision.tool !== 'string') {
        return { decision, adjusted: false };
    }

    const text = String(userPrompt || '');
    const selectedTool = String(decision.tool || '').toLowerCase();
    const isMovementIntent = MOVEMENT_INTENT_PATTERN.test(text);
    const hasAreaDestination = DESTINATION_AREA_PATTERN.test(text) || /\barea\s+[a-z0-9.-]+\b/i.test(text);
    const isExplicitAreaEdit = AREA_EDIT_PATTERN.test(text);

    if (selectedTool === 'area' && isMovementIntent && hasAreaDestination && !isExplicitAreaEdit) {
        const repairedTool = inferMovementTargetTool(text, tools);
        if (repairedTool && repairedTool !== selectedTool) {
            return {
                decision: {
                    ...decision,
                    tool: repairedTool,
                    reason: `${decision.reason || 'planner routing'} | adjusted by validator: movement target belongs to ${repairedTool}, area is destination`,
                },
                adjusted: true,
                reason: 'movement-target-validator',
            };
        }
    }

    return { decision, adjusted: false };
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
            model: options.model || 'plan',
            maxRetriesPerTurn: Number.isFinite(options.maxRetriesPerTurn)
                ? options.maxRetriesPerTurn
                : 3,
        };

        this.supervisor = options.supervisor || null;
        this._alwaysApproveCache = new Map();

        this.turns = [];
        this.history = [];
        this.toolCalls = [];
        this.errorCount = 0;
        this.status = SESSION_STATUS_IDLE;
        this.lastAnswer = null;
        const projectRoot = process.cwd();
        const basePrompt = typeof options.systemPrompt === 'string' ? options.systemPrompt : '';
        this.systemPrompt = `${basePrompt}\n\nYou are working in the current project: ${projectRoot}`.trim();
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
            const preparationTools = this.preparation?.tools && typeof this.preparation.tools === 'object'
                ? this.preparation.tools
                : this._userTools;
            const prepResult = await LoopAgentSession.runPreparation({
                agent: this.agent,
                tools: preparationTools,
                options: { model: this.options.model, maxStepsPerTurn: this.options.maxStepsPerTurn },
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

        debugLog(`[${getTimestamp()}] [LoopSession] Preparation start`, {
            preparationLength: String(preparationText || '').length,
            userPromptLength: String(userPrompt || '').length,
            retries,
        });

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
            debugLog(`[${getTimestamp()}] [LoopSession] Preparation session start`, {
                promptLength: String(preparationPrompt || '').length,
            });
            await session.newPrompt(preparationPrompt);
            if (session.status === SESSION_STATUS_AWAITING_INPUT) {
                debugLog(`[${getTimestamp()}] [LoopSession] Preparation awaiting input`, {
                    status: session.status,
                });
                throw new Error('Preparation loop requires user input.');
            }
            const resultText = coerceResultToText(session.getLastResult());
            const contextEntries = parseContextVariables(resultText, contextPrefix);
            const contextLines = buildContextPieceLines(contextEntries);
            debugLog(`[${getTimestamp()}] [LoopSession] Preparation result parsed`, {
                rawTextLength: String(resultText || '').length,
                contextEntries: contextEntries.length,
                contextLines: contextLines.length,
            });
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
            model: this.options.model,
        });

        for (let stepIndex = 0; stepIndex < maxStepsPerTurn; stepIndex += 1) {
            const decision = await this._requestDecision(userPrompt, turn, stepIndex);
            turn.steps.push({ type: 'planner_decision', decision });
            this._debug('[LoopSession]', 'Planner decision', { stepIndex, decision });

            if (decision && typeof decision.tool === 'string') {
                const toolName = decision.tool;
                const rawToolPrompt = decision.toolPrompt || userPrompt;
                // Coerce to string — planner may return toolPrompt as an object
                const toolPrompt = typeof rawToolPrompt === 'string'
                    ? rawToolPrompt
                    : (rawToolPrompt != null ? JSON.stringify(rawToolPrompt) : userPrompt);

                this.history.push({
                    type: 'tool_call',
                    tool: toolName,
                    prompt: toolPrompt,
                });

                try {
                    const toolResult = await this._executeTool(toolName, toolPrompt, turn);
                    const structuredToolResult = coerceStructuredToolResult(toolResult);
                    // Debug: log tool result type and key properties
                    debugLog(`[${getTimestamp()}] [LoopSession] Tool "${toolName}" returned: type=${typeof toolResult}, structuredType=${typeof structuredToolResult}, requiresConfirmation=${structuredToolResult?.requiresConfirmation}, requiresInput=${structuredToolResult?.requiresInput}`);
                    this._debug('[LoopSession]', 'Tool result', {
                        tool: toolName,
                        prompt: toolPrompt,
                        type: typeof toolResult,
                        structuredType: typeof structuredToolResult,
                        requiresConfirmation: structuredToolResult?.requiresConfirmation,
                        requiresInput: structuredToolResult?.requiresInput,
                    });
                    const displayResult = toolResult && (toolResult.__finalAnswer || toolResult.__cannotComplete)
                        ? toolResult.text
                        : structuredToolResult;
                    turn.usedTools = true;
                    turn.steps.push({
                        type: 'tool_result',
                        tool: toolName,
                        prompt: toolPrompt,
                        result: displayResult,
                    });

                    // Handle interactive tools that require user confirmation or input
                    // When a tool returns requiresConfirmation or requiresInput, stop and return to user
                    if (structuredToolResult && typeof structuredToolResult === 'object' && 
                        (structuredToolResult.requiresConfirmation || structuredToolResult.requiresInput)) {
                        let message = structuredToolResult.message;
                        if (!message) {
                            try {
                                message = JSON.stringify(structuredToolResult, null, 2);
                            } catch (stringifyError) {
                                // Fallback if JSON.stringify fails (circular references, etc.)
                                message = `Tool returned an object that cannot be displayed. Keys: ${Object.keys(structuredToolResult).join(', ')}`;
                            }
                        }
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
                            step: structuredToolResult.step || null
                        });
                        return message;
                    }

                    // Handle successful database/skill results that should be returned immediately
                    // When a tool returns success:true with records or a message, treat as final answer
                    if (structuredToolResult && typeof structuredToolResult === 'object' && 
                        structuredToolResult.success === true && 
                        (structuredToolResult.records || structuredToolResult.message || structuredToolResult.operation)) {
                        // This is a successful skill result - return it as final answer
                        let resultStr;
                        try {
                            resultStr = JSON.stringify(structuredToolResult, null, 2);
                        } catch (stringifyError) {
                            // Fallback if JSON.stringify fails (circular references, etc.)
                            resultStr = `Tool returned a successful result that cannot be displayed. Keys: ${Object.keys(structuredToolResult).join(', ')}`;
                        }
                        debugLog(`[${getTimestamp()}] [LoopSession] Detected successful skill result, returning as final answer`);
                        this._debug('[LoopSession]', 'Tool success result returned as final answer', { tool: toolName });
                        turn.finalAnswer = resultStr;
                        turn.status = SESSION_STATUS_DONE;
                        this.status = SESSION_STATUS_ACTIVE;
                        this.lastAnswer = resultStr;
                        this.history.push({ type: 'final_answer', answer: resultStr });
                        return resultStr;
                    }
                    // Handle explicit failed skill results immediately (avoid re-calling the same tool).
                    if (structuredToolResult && typeof structuredToolResult === 'object' &&
                        structuredToolResult.success === false &&
                        (structuredToolResult.message || structuredToolResult.error || structuredToolResult.operation)) {
                        let resultStr;
                        try {
                            resultStr = JSON.stringify(structuredToolResult, null, 2);
                        } catch (stringifyError) {
                            resultStr = `Tool returned a failed result that cannot be displayed. Keys: ${Object.keys(structuredToolResult).join(', ')}`;
                        }
                        debugLog(`[${getTimestamp()}] [LoopSession] Detected failed skill result, returning as final answer`);
                        this._debug('[LoopSession]', 'Tool failed result returned as final answer', { tool: toolName });
                        turn.finalAnswer = resultStr;
                        turn.status = SESSION_STATUS_FAILED;
                        this.status = SESSION_STATUS_ACTIVE;
                        this.lastAnswer = resultStr;
                        this.history.push({ type: 'final_answer', answer: resultStr, success: false });
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
                        let final;
                        if (typeof displayResult === 'string') {
                            final = displayResult;
                        } else {
                            try {
                                final = JSON.stringify(displayResult, null, 2);
                            } catch {
                                final = String(displayResult);
                            }
                        }
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

            this.errorCount += 1;
            turn.steps.push({
                type: 'planner_error',
                error: 'Invalid or missing tool in planner response.',
            });
            this._debug('[LoopSession]', 'Planner error: invalid or missing tool', {
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
        const pendingTool = getPendingAwaitingInputTool(this.history);
        if (pendingTool) {
            const explicitDifferentToolMention = Object.keys(this.tools || {}).some((toolName) =>
                toolName !== pendingTool
                && typeof userPrompt === 'string'
                && userPrompt.toLowerCase().includes(toolName.toLowerCase())
            );

            if (!explicitDifferentToolMention) {
                const interpretation = this.agent && typeof this.agent.interpretMessage === 'function'
                    ? await this.agent.interpretMessage(userPrompt, { intents: ['accept', 'cancel', 'update'] })
                    : { intent: 'unknown', confidence: 0 };
                const shouldContinuePending = interpretation?.intent === 'accept'
                    || interpretation?.intent === 'cancel'
                    || interpretation?.intent === 'update'
                    || !isLikelyFreshInstruction(userPrompt);

                if (shouldContinuePending) {
                    const decision = buildPendingInputDecision(pendingTool, userPrompt);
                    this._debug('[LoopSession]', 'Pending tool decision', {
                        stepIndex,
                        pendingTool,
                        interpretation,
                        decision,
                    });
                    return decision;
                }
            }
        }

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

        const validated = validateAndRepairPlannerDecision(parsed, userPrompt, this.tools);
        if (validated.adjusted) {
            this._debug('[LoopSession]', 'Planner decision adjusted by validator', {
                stepIndex,
                reason: validated.reason,
                original: parsed,
                adjusted: validated.decision,
            });
            parsed = validated.decision;
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

        const promptPreview = String(resolvedPrompt ?? '').slice(0, 200);
        debugLog(`[${getTimestamp()}] [LoopSession] Calling tool "${toolName}" with prompt: "${promptPreview}"`);
        this._debug('[LoopSession]', 'Calling tool', { tool: toolName, prompt: resolvedPrompt });

        if (this.supervisor) {
            const cacheKey = `alwaysApprove:${toolName}`;
            if (this._alwaysApproveCache.has(cacheKey)) {
                this._debug('[LoopSession]', 'Tool approved via alwaysApprove cache', { tool: toolName });
            } else {
                const decision = await this.supervisor.approve({
                    toolName,
                    toolPrompt: resolvedPrompt,
                });

                if (decision === 'alwaysApprove') {
                    this._alwaysApproveCache.set(cacheKey, true);
                    this._debug('[LoopSession]', 'Tool always approved and cached', { tool: toolName });
                } else if (decision === 'deny') {
                    this._debug('[LoopSession]', 'Tool denied by supervisor', { tool: toolName });
                    return JSON.stringify({
                        success: false,
                        error: `Tool "${toolName}" was denied by supervisor.`,
                    });
                }
            }

            const outputWriter = this.supervisor.getOutputWriter();
            if (outputWriter && typeof outputWriter.write === 'function') {
                await outputWriter.write(`Executing tool: ${toolName}`);
            }
        }

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
