import { parseCode } from '../../lightSOPLang/parser.mjs';
import { buildPreparationPrompt } from './prompts.mjs';
import {
    getParentContext,
} from './runtime.mjs';
import {
    coerceResultToText,
} from './utils.mjs';

function isValidSOPLang(source) {
    if (typeof source !== 'string' || !source.trim()) {
        return false;
    }
    try {
        parseCode(source);
        return true;
    } catch {
        return false;
    }
}

function buildHereDocToken(content, base = 'prep-context') {
    const raw = typeof content === 'string' ? content : '';
    let token = base;
    let counter = 0;
    while (raw.includes(`--begin-${token}--`) || raw.includes(`--end-${token}--`)) {
        counter += 1;
        token = `${base}-${counter}`;
    }
    return token;
}

function wrapPreparationContext(text) {
    const token = buildHereDocToken(text);
    const lines = typeof text === 'string' && text.length ? text.split(/\r?\n/) : [];
    return [
        '@preparation_result assign',
        `--begin-${token}--`,
        ...lines,
        `--end-${token}--`,
    ];
}

function createPrepContextPrompt(prepResult) {
    const contextText = typeof prepResult?.contextText === 'string' ? prepResult.contextText : '';
    const preparationContextLines = [];

    if (contextText) {
        if (isValidSOPLang(contextText)) {
            preparationContextLines.push(...contextText.split(/\r?\n/));
        } else {
            preparationContextLines.push(...wrapPreparationContext(contextText));
        }
    }

    return preparationContextLines;
}

async function runPreparation({
    SessionClass,
    agent,
    skillsDescription,
    commandsRegistry,
    options = {},
    preparationText,
    userPrompt,
    retries = 1,
}) {
    const preparationPrompt = buildPreparationPrompt(preparationText, userPrompt, options.preparationContext);
    if (!preparationPrompt) {
        return { contextEntries: [], contextLines: [] };
    }

    const debugLog = (...args) => SessionClass.debugLog(...args);
    debugLog('[SOPAgenticSession] Preparation start', {
        preparationLength: String(preparationText || '').length,
        userPromptLength: String(userPrompt || '').length,
        retries,
    });

    const sessionOptions = {
        ...options,
        planOnly: false,
        systemPrompt: 'Plan and execute skills to prepare context for the user request.',
        commandsRegistry,
        preparationSession: true,
        enableClarifyContextCommand: Boolean(getParentContext(options.parentContext)),
        parentContext: getParentContext(options.parentContext),
        maxPlanAttempts: Number.isFinite(options.maxPlanAttempts)
            ? options.maxPlanAttempts
            : retries + 1,
    };
    const session = new SessionClass({
        agent,
        skillsDescription,
        options: sessionOptions,
    });
    debugLog('[SOPAgenticSession] Preparation session start', {
        promptLength: String(preparationPrompt || '').length,
    });
    try {
        await session.newPrompt(preparationPrompt, { signal: options.signal || null });
    } catch (error) {
        debugLog('[SOPAgenticSession] Preparation session error', {
            error: error?.message || String(error),
        });
        throw error;
    }

    const failures = Array.isArray(session.lastRunFailures) ? session.lastRunFailures : [];
    if (failures.length) {
        debugLog('[SOPAgenticSession] Preparation session failures', {
            failureCount: failures.length,
            failures,
        });
        throw new Error('Preparation SOP plan reported failures.');
    }
    const lastResult = session.getLastResult();
    const resultText = coerceResultToText(lastResult);
    const preparationPlan = session.currentPlan || '';
    debugLog('[SOPAgenticSession] Preparation result parsed', {
        rawTextLength: String(resultText || '').length,
        contextTextLength: String(resultText || '').length,
    });
    return { contextText: resultText, rawText: resultText, preparationPlan };
}

export {
    createPrepContextPrompt,
    runPreparation,
};
