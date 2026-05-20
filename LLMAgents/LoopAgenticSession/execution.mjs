import {
    FINAL_ANSWER_TOOL,
    CANNOT_COMPLETE_TOOL,
    SESSION_STATUS_RUNNING,
    SESSION_STATUS_AWAITING_INPUT,
    SESSION_STATUS_ACTIVE,
    SESSION_STATUS_DONE,
    SESSION_STATUS_FAILED,
    SESSION_STATUS_INTERRUPTED,
} from '../constants.mjs';
import {
    buildAgenticSessionPlannerPrompt,
    extractJson,
} from './prompts.mjs';
import {
    coerceStructuredToolResult,
    getPendingAwaitingInputTool,
    buildPendingInputDecision,
    isLikelyFreshInstruction,
    getTimestamp,
    injectContextIntoPrompt,
} from './utils.mjs';

const DEBUG_ENABLED = String(process.env.ACHILLES_DEBUG ?? '').toLowerCase() === 'true';
const MOVEMENT_INTENT_PATTERN = /\b(move|relocate|transfer|assign|muta|mută|transfera)\b/i;
const DESTINATION_AREA_PATTERN = /\b(to|into|in|la|catre|către)\s+area\b/i;
const MATERIAL_CUE_PATTERN = /\b(material|materials|conduit|cms|cable|consumable|fixing|crms|supply|supplies)\b/i;
const EQUIPMENT_CUE_PATTERN = /\b(equipment|equipments|tool|tools|device|devices|asset|assets|instrument|instruments)\b/i;
const AREA_EDIT_PATTERN = /\b(area\s+(name|location|description|type)|rename\s+area|update\s+area|edit\s+area|modify\s+area|create\s+area|delete\s+area|list\s+areas|show\s+areas)\b/i;

function debugLog(...args) {
    if (DEBUG_ENABLED) console.log(...args);
}

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

async function requestDecision(session, userPrompt, turn, stepIndex) {
    session._ensureNotCancelled();
    const pendingTool = getPendingAwaitingInputTool(session.history);
    if (pendingTool) {
        const explicitDifferentToolMention = Object.keys(session.tools || {}).some((toolName) =>
            toolName !== pendingTool
            && typeof userPrompt === 'string'
            && userPrompt.toLowerCase().includes(toolName.toLowerCase())
        );

        if (!explicitDifferentToolMention) {
            const interpretation = session.agent && typeof session.agent.interpretMessage === 'function'
                ? await session.agent.interpretMessage(userPrompt, { intents: ['accept', 'cancel', 'update'], signal: session._currentAbortSignal })
                : { intent: 'unknown', confidence: 0 };
            const shouldContinuePending = interpretation?.intent === 'accept'
                || interpretation?.intent === 'cancel'
                || interpretation?.intent === 'update'
                || !isLikelyFreshInstruction(userPrompt);

            if (shouldContinuePending) {
                const decision = buildPendingInputDecision(pendingTool, userPrompt);
                session._debug('[LoopSession]', 'Pending tool decision', {
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
        tools: session.tools,
        history: session.history,
        toolCalls: session.toolCalls,
        userPrompt,
        systemPrompt: session.systemPrompt,
        toolVars: session.toolVars,
    });

    session._debug('[LoopSession]', 'Planner prompt built', {
        stepIndex,
        promptLength: plannerPrompt.length,
    });

    const raw = await session.agent.complete({
        prompt: plannerPrompt,
        model: session.options.model,
        tags: session.options.tags,
        signal: session._currentAbortSignal,
        context: {
            intent: 'agentic-session-planner',
            stepIndex,
            userPrompt,
        },
    });

    session._debug('[LoopSession]', 'Planner raw response', {
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
        session._debug('[LoopSession]', 'Planner JSON parse error', {
            stepIndex,
            error: error.message,
        });
    }

    if (!parsed || typeof parsed !== 'object') {
        session._debug('[LoopSession]', 'Planner returned invalid response', {
            stepIndex,
            parsed,
        });
        throw new Error('Planner did not return a valid JSON object.');
    }

    const validated = validateAndRepairPlannerDecision(parsed, userPrompt, session.tools);
    if (validated.adjusted) {
        session._debug('[LoopSession]', 'Planner decision adjusted by validator', {
            stepIndex,
            reason: validated.reason,
            original: parsed,
            adjusted: validated.decision,
        });
        parsed = validated.decision;
    }

    session._debug('[LoopSession]', 'Planner parsed response', { stepIndex, parsed });

    return parsed;
}

async function runLoopForPrompt(session, userPrompt, turn) {
    const { maxStepsPerTurn, maxErrors } = session.options;
    session._debug('[LoopSession]', 'Run loop start', {
        prompt: userPrompt,
        maxStepsPerTurn,
        maxErrors,
        model: session.options.model,
    });

    for (let stepIndex = 0; stepIndex < maxStepsPerTurn; stepIndex += 1) {
        session._ensureNotCancelled();
        const decision = await session._requestDecision(userPrompt, turn, stepIndex);
        turn.steps.push({ type: 'planner_decision', decision });
        session._debug('[LoopSession]', 'Planner decision', { stepIndex, decision });

        if (decision && typeof decision.tool === 'string') {
            const toolName = decision.tool;
            await session._emitToolReason(decision, stepIndex);
            const rawToolPrompt = decision.toolPrompt || userPrompt;
            const toolPrompt = typeof rawToolPrompt === 'string'
                ? rawToolPrompt
                : (rawToolPrompt != null ? JSON.stringify(rawToolPrompt) : userPrompt);

            session.history.push({
                type: 'tool_call',
                tool: toolName,
                prompt: toolPrompt,
            });

            try {
                const toolResult = await session._executeTool(toolName, toolPrompt, turn);
                session._ensureNotCancelled();
                const structuredToolResult = coerceStructuredToolResult(toolResult);
                debugLog(`[${getTimestamp()}] [LoopSession] Tool "${toolName}" returned: type=${typeof toolResult}, structuredType=${typeof structuredToolResult}, requiresConfirmation=${structuredToolResult?.requiresConfirmation}, requiresInput=${structuredToolResult?.requiresInput}`);
                session._debug('[LoopSession]', 'Tool result', {
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

                if (structuredToolResult && typeof structuredToolResult === 'object'
                    && (structuredToolResult.requiresConfirmation || structuredToolResult.requiresInput)) {
                    let message = structuredToolResult.message;
                    if (!message) {
                        try {
                            message = JSON.stringify(structuredToolResult, null, 2);
                        } catch {
                            message = `Tool returned an object that cannot be displayed. Keys: ${Object.keys(structuredToolResult).join(', ')}`;
                        }
                    }
                    debugLog(`[${getTimestamp()}] [LoopSession] Detected requiresConfirmation/Input, returning message (first 100 chars): "${String(message).substring(0, 100)}..."`);
                    session._debug('[LoopSession]', 'Tool requires input/confirmation', { tool: toolName, message });
                    turn.finalAnswer = message;
                    turn.status = SESSION_STATUS_AWAITING_INPUT;
                    session.status = SESSION_STATUS_AWAITING_INPUT;
                    session.lastAnswer = message;
                    session.history.push({
                        type: SESSION_STATUS_AWAITING_INPUT,
                        answer: message,
                        tool: toolName,
                        step: structuredToolResult.step || null,
                    });
                    return message;
                }

                if (structuredToolResult && typeof structuredToolResult === 'object'
                    && structuredToolResult.success === true
                    && (structuredToolResult.records || structuredToolResult.message || structuredToolResult.operation)) {
                    let resultStr;
                    try {
                        resultStr = JSON.stringify(structuredToolResult, null, 2);
                    } catch {
                        resultStr = `Tool returned a successful result that cannot be displayed. Keys: ${Object.keys(structuredToolResult).join(', ')}`;
                    }
                    debugLog(`[${getTimestamp()}] [LoopSession] Detected successful skill result, returning as final answer`);
                    session._debug('[LoopSession]', 'Tool success result returned as final answer', { tool: toolName });
                    turn.finalAnswer = resultStr;
                    turn.status = SESSION_STATUS_DONE;
                    session.status = SESSION_STATUS_ACTIVE;
                    session.lastAnswer = resultStr;
                    session.history.push({ type: 'final_answer', answer: resultStr });
                    return resultStr;
                }

                if (structuredToolResult && typeof structuredToolResult === 'object'
                    && structuredToolResult.success === false
                    && (structuredToolResult.message || structuredToolResult.error || structuredToolResult.operation)) {
                    let resultStr;
                    try {
                        resultStr = JSON.stringify(structuredToolResult, null, 2);
                    } catch {
                        resultStr = `Tool returned a failed result that cannot be displayed. Keys: ${Object.keys(structuredToolResult).join(', ')}`;
                    }
                    debugLog(`[${getTimestamp()}] [LoopSession] Detected failed skill result, returning as final answer`);
                    session._debug('[LoopSession]', 'Tool failed result returned as final answer', { tool: toolName });
                    turn.finalAnswer = resultStr;
                    turn.status = SESSION_STATUS_FAILED;
                    session.status = SESSION_STATUS_ACTIVE;
                    session.lastAnswer = resultStr;
                    session.history.push({ type: 'final_answer', answer: resultStr, success: false });
                    return resultStr;
                }

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
                        session._debug('[LoopSession]', 'Tool cannot complete', { tool: toolName, final });
                        turn.finalAnswer = final;
                        turn.status = SESSION_STATUS_FAILED;
                        session.status = SESSION_STATUS_FAILED;
                        session.lastAnswer = final;
                        session.failedTurns.push(turn);
                        session.history.push({ type: 'cannot_complete', answer: final });
                        return final;
                    }

                    if (matchesExpected) {
                        session._debug('[LoopSession]', 'Tool final answer accepted', { tool: toolName, final });
                        turn.finalAnswer = final;
                        turn.status = SESSION_STATUS_DONE;
                        session.status = SESSION_STATUS_ACTIVE;
                        session.lastAnswer = final;
                        session.history.push({ type: 'final_answer', answer: final });
                        return final;
                    }

                    session._debug('[LoopSession]', 'Validation failed', {
                        tool: toolName,
                        expected,
                        actual: final,
                        retryCount: turn.retryCount + 1,
                    });
                    turn.retryCount += 1;
                    session.history.push({
                        type: 'validation_failed',
                        expected,
                        actual: final,
                        retryCount: turn.retryCount,
                    });
                    if (turn.retryCount >= turn.maxRetries) {
                        turn.finalAnswer = final;
                        turn.status = SESSION_STATUS_FAILED;
                        session.status = SESSION_STATUS_ACTIVE;
                        session.lastAnswer = final;
                        session.failedTurns.push(turn);
                        session.history.push({ type: 'final_answer', answer: final, validationFailed: true });
                        return final;
                    }
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
                    session._debug('[LoopSession]', 'Repeat tool result threshold reached', {
                        tool: toolName,
                        prompt: toolPrompt,
                    });
                    turn.finalAnswer = final;
                    turn.status = SESSION_STATUS_DONE;
                    session.status = SESSION_STATUS_ACTIVE;
                    session.history.push({ type: 'final_answer', answer: final });
                    return final;
                }
            } catch (error) {
                if (session._isAbortError(error) || session.status === SESSION_STATUS_INTERRUPTED) {
                    throw error;
                }
                session.errorCount += 1;
                turn.steps.push({
                    type: 'tool_error',
                    tool: toolName,
                    prompt: toolPrompt,
                    error: error.message,
                });
                session._debug('[LoopSession]', 'Tool error', {
                    tool: toolName,
                    prompt: toolPrompt,
                    error: error.message,
                    errorCount: session.errorCount,
                    maxErrors,
                });

                if (session.errorCount >= maxErrors) {
                    const message = 'Too many tool errors, aborting.';
                    session._debug('[LoopSession]', 'Aborting due to tool errors', { message });
                    turn.finalAnswer = message;
                    turn.status = SESSION_STATUS_FAILED;
                    session.status = SESSION_STATUS_FAILED;
                    return message;
                }
            }
            continue;
        }

        session.errorCount += 1;
        turn.steps.push({
            type: 'planner_error',
            error: 'Invalid or missing tool in planner response.',
        });
        session._debug('[LoopSession]', 'Planner error: invalid or missing tool', {
            errorCount: session.errorCount,
        });
        if (session.errorCount >= maxErrors) {
            const message = 'Too many planner errors, aborting.';
            session._debug('[LoopSession]', 'Aborting due to planner errors', { message });
            turn.finalAnswer = message;
            turn.status = SESSION_STATUS_FAILED;
            session.status = SESSION_STATUS_FAILED;
            return message;
        }
    }

    const fallback = 'Unable to complete within step limit.';
    session._debug('[LoopSession]', 'Step limit reached', { message: fallback });
    turn.finalAnswer = fallback;
    turn.status = SESSION_STATUS_FAILED;
    session.status = SESSION_STATUS_FAILED;
    session.history.push({ type: 'timeout', message: fallback });
    session.failedTurns.push(turn);
    return fallback;
}

async function newPrompt(session, SessionClass, userPrompt, options = {}) {
    if (!userPrompt || typeof userPrompt !== 'string') {
        throw new Error('newPrompt requires a prompt string.');
    }

    if (session.status === SESSION_STATUS_INTERRUPTED) {
        session.status = SESSION_STATUS_ACTIVE;
    }
    const runSignal = options.signal || session.options.signal || null;
    const promptSignal = session._createPromptAbortController(runSignal);

    try {
        await session._compressHistoryIfNeeded(userPrompt);
    } catch (error) {
        if (session._isAbortError(error) || session.status === SESSION_STATUS_INTERRUPTED) {
            throw error;
        }
        session._debug('[LoopSession]', 'History compression failed; continuing without compression', {
            error: error?.message || String(error),
        });
    }

    if (session.preparation?.text) {
        const preparationTools = session.preparation?.tools && typeof session.preparation.tools === 'object'
            ? session.preparation.tools
            : session._userTools;
        const prepResult = await SessionClass.runPreparation({
            agent: session.agent,
            tools: preparationTools,
            options: {
                model: session.options.model,
                tags: session.options.tags,
                maxStepsPerTurn: session.options.maxStepsPerTurn,
                supervisor: session.supervisor,
                signal: promptSignal,
                parentContext: session.preparation.parentContext || null,
            },
            preparationText: session.preparation.text,
            userPrompt,
            retries: session.preparation.retries ?? 1,
        });
        const contextLines = prepResult?.contextLines || [];
        session.systemPrompt = injectContextIntoPrompt(session.baseSystemPrompt, contextLines);
        userPrompt = injectContextIntoPrompt(userPrompt, contextLines);
    }

    const expected = typeof options.expected === 'string' || typeof options.expected === 'number'
        ? String(options.expected)
        : null;
    const maxRetries = Number.isFinite(options.maxRetries)
        ? options.maxRetries
        : session.options.maxRetriesPerTurn;

    debugLog(`[${getTimestamp()}] [LoopSession] New prompt: "${userPrompt}"`);
    session._debug('[LoopSession]', 'New prompt', { prompt: userPrompt, expected });

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
    session.turns.push(turn);
    session.history.push({ type: 'user', prompt: userPrompt });
    session.status = SESSION_STATUS_RUNNING;

    let answer = null;
    try {
        answer = await session._runLoopForPrompt(userPrompt, turn);
        session.lastAnswer = answer;
    } catch (error) {
        if (session._isAbortError(error) || session.status === SESSION_STATUS_INTERRUPTED) {
            answer = session._markInterrupted(session._cancelReason || 'cancelled', turn);
        } else {
            throw error;
        }
    } finally {
        session._clearPromptAbortController();
    }

    const invariantAnswer = session.getLastResult();
    if (invariantAnswer !== session.lastAnswer) {
        throw new Error('LoopAgentSession invariant violated: getLastResult() mismatch with lastAnswer.');
    }

    return answer;
}

export {
    newPrompt,
    runLoopForPrompt,
    requestDecision,
    validateAndRepairPlannerDecision,
};
