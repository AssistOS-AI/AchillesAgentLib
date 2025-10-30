import { buildMissingMessage, buildNarrative } from '../../SkilledAgents/executor/messages.mjs';
import { extractArgumentsWithLLM, interpretConfirmationWithLLM } from '../../SkilledAgents/executor/llm.mjs';

const ACCEPT_PATTERNS = [
    /\baccept\b/i,
    /\bconfirm(ed)?\b/i,
    /\blooks good\b/i,
    /\bgo ahead\b/i,
    /\bproceed\b/i,
    /\byes\b/i,
];

const CANCEL_PATTERNS = [
    /\bcancel\b/i,
    /\bstop\b/i,
    /\babort\b/i,
    /\bno thanks?\b/i,
    /\bnever mind\b/i,
    /\bdo not\b.*\bproceed\b/i,
    /don't\b.*\bproceed\b/i,
];

function analyseIntentTokens(message) {
    if (!message || typeof message !== 'string') {
        return { accept: false, cancel: false, normalized: '' };
    }
    const normalized = message.trim().toLowerCase();
    if (!normalized) {
        return { accept: false, cancel: false, normalized };
    }
    const accept = ACCEPT_PATTERNS.some((pattern) => pattern.test(normalized));
    const cancel = CANCEL_PATTERNS.some((pattern) => pattern.test(normalized));
    return { accept, cancel, normalized };
}

function detectExplicitIntent(message) {
    const { accept, cancel, normalized } = analyseIntentTokens(message);
    if (cancel && !accept) {
        return 'cancel';
    }
    if (accept && !cancel) {
        if (/\bbut\b|\bhowever\b|\bexcept\b|\bunless\b/.test(normalized)) {
            return null;
        }
        if (
            /\baccept\b|\bconfirm(ed)?\b|\bproceed\b|\bgo ahead\b|\blooks good\b/.test(normalized)
            || normalized.length <= 48
        ) {
            return 'accept';
        }
    }
    return null;
}

function tryParseManualInput(context, input, { allowSingleValueFallback = true } = {}) {
    if (!input || typeof input !== 'string') {
        return {};
    }

    const trimmed = input.trim();

    const markdownPairs = context.llmAgent && typeof context.llmAgent.parseMarkdownKeyValues === 'function'
        ? context.llmAgent.parseMarkdownKeyValues(trimmed)
        : {};

    const updates = { ...markdownPairs };
    const tokens = trimmed.split(/[,;\n]+/);
    for (const token of tokens) {
        const [maybeName, ...rest] = token.split(/[:=]/);
        if (!maybeName || !rest.length) {
            continue;
        }
        const key = maybeName.trim();
        const value = rest.join(':').trim();
        if (!key || !value) {
            continue;
        }
        if (context.definitionMap.has(key)) {
            updates[key] = value;
        } else {
            const normalized = context.argumentDefinitions.find((def) => def.name.toLowerCase() === key.toLowerCase());
            if (normalized) {
                updates[normalized.name] = value;
            }
        }
    }

    if (allowSingleValueFallback && Object.keys(updates).length === 0) {
        const missingRequired = context.missingRequired();
        if (missingRequired.length === 1) {
            const paramName = missingRequired[0];
            updates[paramName] = trimmed;
        }
    }

    return updates;
}

async function applyUpdatesFromMessage(context, message, {
    taskDescription,
    allowSingleValueFallback = true,
    manualOnly = false,
} = {}) {
    let updates = null;
    if (!manualOnly) {
        updates = await extractArgumentsWithLLM(context, message, { taskDescription });
    }
    if (!updates || Object.keys(updates).length === 0) {
        updates = tryParseManualInput(context, message, { allowSingleValueFallback });
    }
    if (updates && Object.keys(updates).length) {
        await context.applyUpdates(updates);
        return true;
    }
    return false;
}

async function interactiveMainLoop(context, {
    readUserPrompt,
    taskDescription = '',
} = {}) {
    if (typeof readUserPrompt !== 'function') {
        throw new Error('interactiveMainLoop requires a readUserPrompt function.');
    }

    if (taskDescription) {
        await applyUpdatesFromMessage(context, taskDescription, {
            taskDescription,
            allowSingleValueFallback: false,
            manualOnly: true,
        });
    }

    while (true) {
        const validation = context.validationState();
        if (!validation.valid) {
            const prompt = buildMissingMessage(context, validation);
            console.log(`${prompt}\n`);
            const input = await readUserPrompt('> ');
            if (!input || !input.trim()) {
                console.log('I did not receive any details. Let’s try again.');
                continue;
            }
            if (context.isCancellationIntent(input)) {
                throw new Error('Skill execution cancelled by user.');
            }
            const applied = await applyUpdatesFromMessage(context, input, { taskDescription });
            if (!applied) {
                console.log('I could not understand the changes. Please rephrase or provide key/value pairs.');
            }
            continue;
        }

        const needsConfirmation = context.skill.needConfirmation !== false;

        if (!needsConfirmation) {
            return context.toJSON();
        }

        const summary = await buildNarrative(context);
        const confirmation = await readUserPrompt(`${summary}\n> `);
        if (!confirmation || !confirmation.trim()) {
            console.log('I need a response to continue.');
            continue;
        }
        if (context.isCancellationIntent(confirmation)) {
            throw new Error('Skill execution cancelled by user.');
        }

        const intentTokens = analyseIntentTokens(confirmation);
        const explicitIntent = detectExplicitIntent(confirmation);

        if (explicitIntent === 'cancel') {
            throw new Error('Skill execution cancelled by user.');
        }
        if (explicitIntent === 'accept') {
            return context.toJSON();
        }

        let classification = context.llmAgent && typeof context.llmAgent.interpretMessage === 'function'
            ? await context.llmAgent.interpretMessage(confirmation, { intents: ['accept', 'cancel', 'update', 'ideas'] })
            : null;

        if (classification && classification.intent === 'cancel' && !intentTokens.cancel) {
            classification = null;
        }

        if (classification) {
            if (classification.intent === 'cancel') {
                throw new Error('Skill execution cancelled by user.');
            }
            if (classification.intent === 'accept') {
                if (explicitIntent === 'accept' || (intentTokens.accept && !intentTokens.cancel)) {
                    return context.toJSON();
                }
                classification = null;
            }
        }

        if (classification && classification.intent === 'update') {
            if (classification.updates && Object.keys(classification.updates).length) {
                await context.applyUpdates(classification.updates);
            }
            await applyUpdatesFromMessage(context, confirmation, { taskDescription });
            continue;
        }

        let interpretation = await interpretConfirmationWithLLM(context, confirmation);
        if (interpretation && interpretation.action === 'cancel' && !intentTokens.cancel) {
            interpretation = null;
        }

        if (interpretation) {
            if (interpretation.action === 'accept') {
                if (explicitIntent === 'accept' || (intentTokens.accept && !intentTokens.cancel)) {
                    return context.toJSON();
                }
            } else if (interpretation.action === 'cancel') {
                throw new Error('Skill execution cancelled by user.');
            } else if (interpretation.action === 'update' && interpretation.updates) {
                await context.applyUpdates(interpretation.updates);
                await applyUpdatesFromMessage(context, confirmation, { taskDescription });
                continue;
            }
        }

        const fallbackApplied = await applyUpdatesFromMessage(context, confirmation, { taskDescription });
        if (!fallbackApplied) {
            console.log('I did not understand that response. Please reply with "accept", "cancel", or describe the changes.');
        }
    }
}

export {
    interactiveMainLoop,
};
