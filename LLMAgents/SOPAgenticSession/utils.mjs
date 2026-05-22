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

function cloneSerializable(value) {
    if (value === null || value === undefined) {
        return value;
    }
    try {
        return JSON.parse(JSON.stringify(value));
    } catch {
        return String(value);
    }
}

function coerceStructuredResult(value) {
    if (value == null) {
        return value;
    }
    if (typeof value === 'object') {
        return value;
    }
    if (typeof value === 'string') {
        try {
            return JSON.parse(value);
        } catch {
            return value;
        }
    }
    return value;
}

function formatInterruptionMessage(reason = 'cancelled') {
    const normalized = String(reason || 'cancelled').trim().toLowerCase();
    if (!normalized || normalized === 'cancelled') {
        return 'Interrupted by user';
    }
    if (normalized === 'esc' || normalized === 'escape' || normalized === 'external-signal' || normalized === 'user') {
        return 'Interrupted by user';
    }
    return `Interrupted: ${reason}`;
}

function isInteractiveToolResult(value) {
    const structured = coerceStructuredResult(value);
    return Boolean(structured && typeof structured === 'object' && (structured.requiresInput || structured.requiresConfirmation));
}

function getPendingToolFromHistory(history = []) {
    for (let i = history.length - 1; i >= 0; i -= 1) {
        const entry = history[i];
        if (entry?.type === 'awaiting_input' && typeof entry.tool === 'string' && entry.tool.trim()) {
            return entry.tool.trim();
        }
        if (entry?.type === 'final_answer' || entry?.type === 'cannot_complete') {
            break;
        }
    }
    return null;
}

function isLikelyFreshInstruction(prompt = '') {
    const text = String(prompt || '').trim();
    if (!text) return false;
    return /^(list|show|display|view|get|find|search|add|create|new|update|edit|change|delete|remove|import|wipe|help|exit|quit|start|stop)\b/i.test(text);
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

export {
    injectContextIntoPrompt,
    coerceResultToText,
    formatLogValue,
    cloneSerializable,
    coerceStructuredResult,
    formatInterruptionMessage,
    isInteractiveToolResult,
    getPendingToolFromHistory,
    isLikelyFreshInstruction,
    runWithRetry,
};
