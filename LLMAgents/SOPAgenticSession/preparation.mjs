import { parseCode } from '../../lightSOPLang/parser.mjs';
import { buildPreparationPrompt } from './prompts.mjs';
import {
    getParentContext,
} from './runtime.mjs';
import {
    coerceResultToText,
    runWithRetry,
} from './utils.mjs';

function encodeSopString(value = '') {
    return JSON.stringify(String(value ?? ''));
}

function buildDirectToolPlan(toolName, userPrompt) {
    return [
        `@pendingResult ${toolName} ${encodeSopString(userPrompt)}`,
        '@lastAnswer final_answer $pendingResult',
    ].join('\n');
}

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

function commentLines(lines) {
    return lines.map((line) => (line ? `# ${line}` : '#'));
}

function createPrepContextPrompt(prepResult) {
    const contextText = typeof prepResult?.contextText === 'string' ? prepResult.contextText : '';
    const preparationPlan = prepResult?.preparationPlan || '';
    const preparationContextLines = [];

    if (preparationPlan) {
        preparationContextLines.push(...commentLines([
            'As preparation to provide context, the following plan was executed:',
            ...preparationPlan.split(/\r?\n/),
            '',
        ]));
    }
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

    const attemptRun = async () => {
        const sessionOptions = {
            ...options,
            planOnly: false,
            systemPrompt: 'Plan and execute skills to prepare context for the user request.',
            commandsRegistry,
            preparationSession: true,
            enableClarifyContextCommand: Boolean(getParentContext(options.parentContext)),
            parentContext: getParentContext(options.parentContext),
        };
        const session = new SessionClass({
            agent,
            skillsDescription,
            options: sessionOptions,
        });
        debugLog('[SOPAgenticSession] Preparation session start', {
            promptLength: String(preparationPrompt || '').length,
        });
        await session.newPrompt(preparationPrompt, { signal: options.signal || null });
        const failures = Array.isArray(session.lastRunFailures) ? session.lastRunFailures : [];
        if (failures.length) {
            debugLog('[SOPAgenticSession] Preparation session failures', {
                failureCount: failures.length,
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
    };

    return runWithRetry(attemptRun, retries);
}

export {
    buildDirectToolPlan,
    createPrepContextPrompt,
    runPreparation,
};
