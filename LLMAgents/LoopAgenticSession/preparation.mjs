import { buildPreparationPrompt } from './prompts.mjs';
import { getParentContext } from './runtime.mjs';
import {
    coerceResultToText,
    getTimestamp,
    runWithRetry,
} from './utils.mjs';
import {
    SESSION_STATUS_AWAITING_INPUT,
    SESSION_STATUS_INTERRUPTED,
} from '../constants.mjs';

const PREPARATION_CONTEXT_PREFIX = '@context_';

function debugLog(logger, ...args) {
    if (logger) {
        logger.log(...args);
    }
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

async function runPreparation({
    SessionClass,
    agent,
    tools,
    options = {},
    preparationText,
    userPrompt,
    contextPrefix = PREPARATION_CONTEXT_PREFIX,
    retries = 1,
}) {
    const preparationPrompt = buildPreparationPrompt(preparationText, userPrompt, options.preparationContext);
    if (!preparationPrompt) {
        return { contextEntries: [], contextLines: [] };
    }

    const logger = options.logger || null;
    debugLog(logger, `[${getTimestamp()}] [LoopSession] Preparation start`, {
        preparationLength: String(preparationText || '').length,
        userPromptLength: String(userPrompt || '').length,
        retries,
    });

    const attemptRun = async () => {
        const sessionOptions = {
            ...options,
            systemPrompt: 'Execute skills to prepare context for the user request.',
            preparationSession: true,
            enableClarifyContextTool: Boolean(getParentContext(options.parentContext)),
            parentContext: getParentContext(options.parentContext),
        };
        const session = new SessionClass({
            agent,
            tools,
            options: sessionOptions,
        });
        debugLog(logger, `[${getTimestamp()}] [LoopSession] Preparation session start`, {
            promptLength: String(preparationPrompt || '').length,
        });
        await session.newPrompt(preparationPrompt);
        if (session.status === SESSION_STATUS_AWAITING_INPUT) {
            debugLog(logger, `[${getTimestamp()}] [LoopSession] Preparation awaiting input`, {
                status: session.status,
            });
            throw new Error('Preparation loop requires user input.');
        }
        if (session.status === SESSION_STATUS_INTERRUPTED) {
            throw new Error('Preparation loop interrupted.');
        }
        const resultText = coerceResultToText(session.getLastResult());
        const contextEntries = parseContextVariables(resultText, contextPrefix);
        const contextLines = buildContextPieceLines(contextEntries);
        debugLog(logger, `[${getTimestamp()}] [LoopSession] Preparation result parsed`, {
            rawTextLength: String(resultText || '').length,
            contextEntries: contextEntries.length,
            contextLines: contextLines.length,
        });
        return { contextEntries, contextLines, rawText: resultText };
    };

    return runWithRetry(attemptRun, retries);
}

export {
    PREPARATION_CONTEXT_PREFIX,
    parseContextVariables,
    buildContextPieceLines,
    runPreparation,
};
