import {
    FINAL_ANSWER_TOOL,
    CANNOT_COMPLETE_TOOL,
    FINAL_ANSWER_DESCRIPTION,
    CANNOT_COMPLETE_DESCRIPTION,
    CLARIFY_CONTEXT_DESCRIPTION,
    CLARIFY_CONTEXT_UNAVAILABLE,
    SESSION_STATUS_INTERRUPTED,
    normalizeResponsePayload,
} from '../constants.mjs';
import {
    estimateTokens,
    formatInterruptionMessage,
    getPendingAwaitingInputTool,
    getTimestamp,
} from './utils.mjs';

const DEBUG_ENABLED = String(process.env.ACHILLES_DEBUG ?? '').toLowerCase() === 'true';

function debugLog(...args) {
    if (DEBUG_ENABLED) console.log(...args);
}

function getParentContext(value) {
    return value && typeof value === 'object' ? value : null;
}

function normaliseClarificationQuestions(input) {
    if (Array.isArray(input)) {
        return input.map((item) => String(item ?? '').trim()).filter(Boolean).join('\n');
    }
    return String(input ?? '').trim();
}

function stringifyContextValue(value) {
    try {
        return JSON.stringify(value, null, 2);
    } catch {
        return String(value);
    }
}

function buildClarifyContextPrompt(parentContext, questions) {
    return [
        'You are given a context block and one or more questions.',
        'Answer the questions using ONLY the information present in the context block.',
        `If the information is not present, answer exactly: "${CLARIFY_CONTEXT_UNAVAILABLE}"`,
        'Do not infer missing details. Do not use outside knowledge.',
        '',
        '<context>',
        stringifyContextValue(parentContext),
        '</context>',
        '',
        'Question(s):',
        questions,
    ].join('\n');
}

function stringifyClarificationResult(result) {
    if (result == null) return '';
    if (typeof result === 'string') return result.trim();
    if (typeof result?.result === 'string') return result.result.trim();
    if (typeof result?.text === 'string') return result.text.trim();
    return stringifyContextValue(result);
}

function buildFinalAnswerTool(session) {
    return {
        description: FINAL_ANSWER_DESCRIPTION,
        handler: async (_agent, payload) => {
            const text = normalizeResponsePayload(payload);
            session.lastAnswer = text;
            return {
                __finalAnswer: true,
                text,
            };
        },
    };
}

function buildCannotCompleteTool(session) {
    return {
        description: CANNOT_COMPLETE_DESCRIPTION,
        handler: async (_agent, payload) => {
            const text = normalizeResponsePayload(payload, 'Agent cannot complete the task.');
            session.lastAnswer = text;
            return {
                __cannotComplete: true,
                text,
            };
        },
    };
}

function buildClarifyContextTool(session, parentContext) {
    return {
        description: CLARIFY_CONTEXT_DESCRIPTION,
        handler: async (_agent, payload) => {
            const questions = normaliseClarificationQuestions(payload);
            if (!questions || !parentContext || typeof session.agent.executePrompt !== 'function') {
                return CLARIFY_CONTEXT_UNAVAILABLE;
            }
            const result = await session.agent.executePrompt(buildClarifyContextPrompt(parentContext, questions), {
                model: session.options.model || null,
                tags: session.options.tags || null,
                reasoningEffort: session.options.reasoningEffort || null,
                signal: session._currentAbortSignal || null,
            });
            return stringifyClarificationResult(result) || CLARIFY_CONTEXT_UNAVAILABLE;
        },
    };
}

function recordToolsRefreshed(session, metadata = {}) {
    const normalizeList = (value) => Array.isArray(value)
        ? value.filter((entry) => typeof entry === 'string' && entry.trim())
        : [];
    session.history.push({
        type: 'system',
        event: 'tools_refreshed',
        message: 'Available tools have been refreshed.',
        added: normalizeList(metadata.added),
        updated: normalizeList(metadata.updated),
        removed: normalizeList(metadata.removed),
        at: new Date().toISOString(),
    });
}

function estimateHistoryTokens(session, entries = session.history) {
    if (!Array.isArray(entries) || !entries.length) {
        return 0;
    }
    return estimateTokens(JSON.stringify(entries));
}

function hasPendingAwaitingInput(session) {
    return Boolean(getPendingAwaitingInputTool(session.history));
}

function isAbortError(error) {
    return Boolean(error && (
        error.name === 'AbortError'
        || error.code === 'ABORT_ERR'
        || /aborted|cancelled|canceled/i.test(error.message || '')
    ));
}

function createPromptAbortController(session, externalSignal = null) {
    const controller = new AbortController();
    session._currentAbortController = controller;
    session._currentAbortSignal = controller.signal;
    session._cancelReason = null;
    if (externalSignal && typeof externalSignal.addEventListener === 'function') {
        externalSignal.addEventListener('abort', () => {
            const externalReason = externalSignal.reason;
            session.cancel(typeof externalReason === 'string' && externalReason.trim()
                ? externalReason
                : 'external-signal');
        }, { once: true });
    }
    return controller.signal;
}

function clearPromptAbortController(session) {
    session._currentAbortController = null;
    session._currentAbortSignal = null;
}

function ensureNotCancelled(session) {
    if (session.status !== SESSION_STATUS_INTERRUPTED) {
        return;
    }
    const error = new Error(session._cancelReason || 'Operation cancelled.');
    error.name = 'AbortError';
    throw error;
}

function markInterrupted(session, reason = 'cancelled', turn = null) {
    const message = formatInterruptionMessage(reason);
    session.status = SESSION_STATUS_INTERRUPTED;
    session.lastAnswer = message;
    session._cancelReason = reason;
    if (turn) {
        turn.finalAnswer = message;
        turn.status = SESSION_STATUS_INTERRUPTED;
    }
    const lastEntry = session.history[session.history.length - 1];
    if (!(lastEntry && lastEntry.type === 'system' && lastEntry.event === SESSION_STATUS_INTERRUPTED)) {
        session.history.push({
            type: 'system',
            event: SESSION_STATUS_INTERRUPTED,
            by: 'user',
            reason,
            message,
            at: new Date().toISOString(),
        });
    }
    return message;
}

function cancel(session, reason = 'cancelled') {
    markInterrupted(session, String(reason || 'cancelled'));
    if (session._currentAbortController) {
        session._currentAbortController.abort(session._cancelReason);
    }
}

async function emitToolReason(session, decision, stepIndex) {
    const toolName = String(decision?.tool || '').trim();
    if (!toolName || toolName === FINAL_ANSWER_TOOL || toolName === CANNOT_COMPLETE_TOOL) {
        return;
    }
    const reason = String(decision?.reason || '').trim();
    if (!reason || !session.supervisor || typeof session.supervisor.getOutputWriter !== 'function') {
        return;
    }
    try {
        const outputWriter = session.supervisor.getOutputWriter();
        if (outputWriter && typeof outputWriter.write === 'function') {
            await outputWriter.write({
                type: 'tool_reason',
                tool: toolName,
                reason,
                stepIndex,
            });
        }
    } catch (error) {
        session._debug('[LoopSession]', 'Tool reason output failed', {
            tool: toolName,
            error: error?.message || String(error),
        });
    }
}

async function executeTool(session, toolName, toolPrompt) {
    session._ensureNotCancelled();
    const toolEntry = session.tools[toolName];
    if (!toolEntry || typeof toolEntry.handler !== 'function') {
        throw new Error(`Unknown tool: ${toolName}`);
    }

    const resolvedPrompt = typeof toolPrompt === 'string'
        ? toolPrompt.replace(/\$\$([A-Za-z0-9_-]+)/g, (match, resultRef) => {
            if (!session.toolVars.has(resultRef)) {
                throw new Error(`Unknown tool variable: ${resultRef}`);
            }
            const value = session.toolVars.get(resultRef);
            return typeof value === 'string' ? value : JSON.stringify(value);
        })
        : toolPrompt;

    const promptPreview = String(resolvedPrompt ?? '').slice(0, 200);
    debugLog(`[${getTimestamp()}] [LoopSession] Calling tool "${toolName}" with prompt: "${promptPreview}"`);
    session._debug('[LoopSession]', 'Calling tool', { tool: toolName, prompt: resolvedPrompt });

    if (session.supervisor) {
        const cacheKey = `alwaysApprove:${toolName}`;
        if (session._alwaysApproveCache.has(cacheKey)) {
            session._debug('[LoopSession]', 'Tool approved via alwaysApprove cache', { tool: toolName });
        } else {
            const decision = await session.supervisor.approve({
                toolName,
                toolPrompt: resolvedPrompt,
            });

            if (decision === 'alwaysApprove') {
                session._alwaysApproveCache.set(cacheKey, true);
                session._debug('[LoopSession]', 'Tool always approved and cached', { tool: toolName });
            } else if (decision === 'deny') {
                session._debug('[LoopSession]', 'Tool denied by supervisor', { tool: toolName });
                return JSON.stringify({
                    success: false,
                    error: `Tool "${toolName}" was denied by supervisor.`,
                });
            }
        }

        const outputWriter = session.supervisor.getOutputWriter();
        if (outputWriter && typeof outputWriter.write === 'function') {
            await outputWriter.write(`Executing tool: ${toolName}`);
        }
    }

    session.agent.currentSession = session;
    let result;
    try {
        result = await toolEntry.handler(session.agent, resolvedPrompt, {
            signal: session._currentAbortSignal,
            reason: session._cancelReason,
            session,
        });
    } finally {
        session.agent.currentSession = null;
    }

    session.toolVarCounter += 1;
    const resultRef = `${toolName}-res-${session.toolVarCounter}`;
    const storedValue = result && (result.__finalAnswer || result.__cannotComplete)
        ? result.text
        : result;
    session.toolVars.set(resultRef, storedValue);

    session.toolCalls.push({
        tool: toolName,
        prompt: toolPrompt,
        resultRef,
    });
    session.history.push({
        type: 'tool',
        tool: toolName,
        prompt: toolPrompt,
        resultRef,
    });

    return result;
}

export {
    getParentContext,
    recordToolsRefreshed,
    estimateHistoryTokens,
    hasPendingAwaitingInput,
    isAbortError,
    createPromptAbortController,
    clearPromptAbortController,
    ensureNotCancelled,
    markInterrupted,
    cancel,
    buildFinalAnswerTool,
    buildCannotCompleteTool,
    buildClarifyContextTool,
    emitToolReason,
    executeTool,
};
