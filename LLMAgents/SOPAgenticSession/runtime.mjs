import {
    FINAL_ANSWER_TOOL,
    FINAL_ANSWER_DESCRIPTION,
    CANNOT_COMPLETE_TOOL,
    CANNOT_COMPLETE_DESCRIPTION,
    CLARIFY_CONTEXT_TOOL,
    CLARIFY_CONTEXT_DESCRIPTION,
    CLARIFY_CONTEXT_UNAVAILABLE,
    SESSION_STATUS_INTERRUPTED,
    normalizeResponsePayload,
} from '../constants.mjs';
import {
    formatInterruptionMessage,
    formatLogValue,
    isInteractiveToolResult,
} from './utils.mjs';

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
            session.cancel('external-signal');
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

function markInterrupted(session, reason = 'cancelled') {
    const message = formatInterruptionMessage(reason);
    session.status = SESSION_STATUS_INTERRUPTED;
    session._cancelReason = reason;
    session.pendingTool = null;
    session.lastExecution = {
        variables: session.lastExecution?.variables || {},
        lastAnswer: message,
    };
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

function getRecentInterruptions(session, limit = 5) {
    if (!Array.isArray(session.history) || !session.history.length) {
        return [];
    }
    return session.history
        .filter((entry) => entry?.type === 'system' && entry?.event === SESSION_STATUS_INTERRUPTED)
        .slice(-limit)
        .map((entry) => ({
            by: entry.by || 'user',
            reason: entry.reason || null,
            message: entry.message || null,
            at: entry.at || null,
        }));
}

function cancel(session, reason = 'cancelled') {
    markInterrupted(session, String(reason || 'cancelled'));
    if (session._currentAbortController) {
        session._currentAbortController.abort(session._cancelReason);
    }
}

async function emitCommandComment(session, payload) {
    const commandName = String(payload?.command || '').trim();
    if (!commandName || commandName === FINAL_ANSWER_TOOL || commandName === CANNOT_COMPLETE_TOOL) {
        return;
    }
    const reason = String(payload?.comment || '').trim();
    if (!reason || !session.supervisor || typeof session.supervisor.getOutputWriter !== 'function') {
        return;
    }
    try {
        const outputWriter = session.supervisor.getOutputWriter();
        if (outputWriter && typeof outputWriter.write === 'function') {
            await outputWriter.write({
                type: 'tool_reason',
                tool: commandName,
                reason,
                stepIndex: Number.isFinite(payload?.lineNumber) ? payload.lineNumber : null,
            });
        }
    } catch (error) {
        session._debug('[SOPAgenticSession] Tool reason output failed', {
            tool: commandName,
            error: error?.message || String(error),
        });
    }
}

async function answerParentContextClarification(session, questions) {
    const questionText = normaliseClarificationQuestions(questions);
    if (!questionText || !session.parentContextForClarification || typeof session.agent.executePrompt !== 'function') {
        return CLARIFY_CONTEXT_UNAVAILABLE;
    }
    const result = await session.agent.executePrompt(buildClarifyContextPrompt(session.parentContextForClarification, questionText), {
        model: session.options.model || null,
        tags: session.options.tags || null,
        signal: session._currentAbortSignal || null,
    });
    return stringifyClarificationResult(result) || CLARIFY_CONTEXT_UNAVAILABLE;
}

function wrapExecutionRegistry(session, registry) {
    if (typeof registry.executeCommand !== 'function' || typeof registry.listCommands !== 'function') {
        throw new Error('commandsRegistry must provide executeCommand and listCommands functions.');
    }
    const executeCommand = registry.executeCommand.bind(registry);
    const listCommands = registry.listCommands.bind(registry);
    return {
        executeCommand: async (payload, responder) => {
            const commandName = payload?.command || '';
            const args = Array.isArray(payload?.args) ? payload.args : [];
            if (payload?.command === FINAL_ANSWER_TOOL) {
                const args = Array.isArray(payload?.args) ? payload.args : [];
                const text = normalizeResponsePayload(args[0] ?? '');
                session._lastFinalAnswer = text;
                return responder.success(text);
            }
            if (payload?.command === CLARIFY_CONTEXT_TOOL) {
                const args = Array.isArray(payload?.args) ? payload.args : [];
                const questions = args.length ? args : payload?.raw;
                const result = await session._answerParentContextClarification(questions);
                return responder.success(result);
            }
            if (payload?.command === CANNOT_COMPLETE_TOOL) {
                const text = normalizeResponsePayload(payload?.args?.[0] ?? '');
                session._lastFinalAnswer = text;
                return responder.fail(text);
            }
            await session._emitCommandComment(payload);
            const wrappedResponder = {
                success: async (data) => {
                    const interactive = isInteractiveToolResult(data);
                    if (interactive) {
                        session.pendingTool = commandName;
                        session.history.push({ type: 'awaiting_input', tool: commandName, answer: formatLogValue(data) });
                    } else {
                        session.pendingTool = null;
                    }
                    return responder.success(data);
                },
                fail: async (error) => {
                    const interactive = isInteractiveToolResult(error);
                    if (interactive) {
                        session.pendingTool = commandName;
                        session.history.push({ type: 'awaiting_input', tool: commandName, answer: formatLogValue(error) });
                    } else {
                        session.pendingTool = null;
                    }
                    return responder.fail(error);
                },
            };
            return executeCommand({ ...payload, session }, wrappedResponder);
        },
        listCommands: () => {
            const commands = listCommands() || [];
            const names = commands.map((cmd) => cmd?.name || cmd?.command);
            if (!names.includes(FINAL_ANSWER_TOOL)) {
                commands.push({
                    name: FINAL_ANSWER_TOOL,
                    description: FINAL_ANSWER_DESCRIPTION,
                });
            }
            if (!names.includes(CANNOT_COMPLETE_TOOL)) {
                commands.push({
                    name: CANNOT_COMPLETE_TOOL,
                    description: CANNOT_COMPLETE_DESCRIPTION,
                });
            }
            if (session.clarifyContextAvailable && !names.includes(CLARIFY_CONTEXT_TOOL)) {
                commands.push({
                    name: CLARIFY_CONTEXT_TOOL,
                    description: CLARIFY_CONTEXT_DESCRIPTION,
                });
            }
            return commands;
        },
    };
}

export {
    getParentContext,
    recordToolsRefreshed,
    isAbortError,
    createPromptAbortController,
    clearPromptAbortController,
    ensureNotCancelled,
    markInterrupted,
    getRecentInterruptions,
    cancel,
    emitCommandComment,
    answerParentContextClarification,
    wrapExecutionRegistry,
};
