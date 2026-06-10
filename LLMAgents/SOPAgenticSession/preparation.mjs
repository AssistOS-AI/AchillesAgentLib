import { buildPreparationPrompt } from './prompts.mjs';
import {
    getParentContext,
} from './runtime.mjs';
import {
    coerceResultToText,
} from './utils.mjs';

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

    const logger = options.logger || null;
    const debugLog = (...args) => {
        if (logger) logger.log(...args);
    };
    debugLog('[SOPAgenticSession] Preparation start', {
        preparationLength: String(preparationText || '').length,
        userPromptLength: String(userPrompt || '').length,
        retries,
        hasParentContext: Boolean(getParentContext(options.parentContext)),
        parentHistory: Array.isArray(options.parentContext?.history) ? options.parentContext.history.length : 0,
    });

    const sessionOptions = {
        ...options,
        planOnly: false,
        systemPrompt: 'Plan and execute skills to prepare context for the user request.',
        commandsRegistry,
        preparationSession: true,
        enableClarifyContextCommand: true,
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
    runPreparation,
};
