import { friendlyName } from './context.mjs';

const OPTION_DISPLAY_LIMIT = 10;

const joinList = (items) => {
    if (!items.length) {
        return '';
    }
    if (items.length === 1) {
        return items[0];
    }
    const head = items.slice(0, -1).join(', ');
    return `${head} and ${items[items.length - 1]}`;
};

const resolveDefinition = (context, name) => {
    if (!context || !(context.definitionMap instanceof Map)) {
        return null;
    }
    return context.definitionMap.get(name) || null;
};

function buildOptionDetail(context, name) {
    const definition = resolveDefinition(context, name);
    const isEnumerated = Boolean(
        definition &&
        (
            typeof definition.enumerator === 'function' ||
            Array.isArray(definition.options) ||
            (typeof definition.type === 'string' && definition.type.startsWith('%'))
        )
    );

    if (typeof context.getOptionSamplesDetailed === 'function') {
        const detail = context.getOptionSamplesDetailed(name, OPTION_DISPLAY_LIMIT) || {};
        const labels = Array.isArray(detail.labels) ? detail.labels.slice(0, OPTION_DISPLAY_LIMIT) : [];
        const displayedCount = Number.isInteger(detail.displayedCount)
            ? detail.displayedCount
            : labels.length;
        const totalCount = Number.isInteger(detail.totalCount)
            ? detail.totalCount
            : labels.length;
        return { labels, totalCount, displayedCount, enumerated: isEnumerated };
    }

    if (typeof context.getOptionSamples === 'function') {
        const labels = (context.getOptionSamples(name, OPTION_DISPLAY_LIMIT) || [])
            .slice(0, OPTION_DISPLAY_LIMIT);
        return {
            labels,
            totalCount: labels.length,
            displayedCount: labels.length,
            enumerated: isEnumerated,
        };
    }

    return { labels: [], totalCount: 0, displayedCount: 0, enumerated: isEnumerated };
}

function appendFieldGuidance(lines, description, detail) {
    lines.push(`• ${description}.`);
    if (!detail.labels.length) {
        return;
    }
    const heading = detail.enumerated ? '  Options:' : '  For example:';
    lines.push(heading);
    for (const label of detail.labels) {
        lines.push(`    - ${label}`);
    }
    if (detail.totalCount > detail.displayedCount) {
        const suffix = detail.enumerated ? ' options' : '';
        lines.push(`    (showing ${detail.displayedCount} of ${detail.totalCount}${suffix})`);
    }
}

function buildMissingMessage(context, validation) {
    const lines = [];

    if (validation.invalid.length) {
        lines.push(`Ignored values for ${joinList(validation.invalid.map(friendlyName))} because they did not match the expected format.`);
    }

    if (validation.missingRequired.length) {
        lines.push('To continue I need the following details:');
        for (const name of validation.missingRequired) {
            const description = context.describeArgument(name);
            const detail = buildOptionDetail(context, name);
            appendFieldGuidance(lines, description, detail);
        }
    }

    const promptOnlyRequired = Boolean(context?.skill?.promptOnlyRequiredArguments);

    if (validation.missingOptional.length && !promptOnlyRequired) {
        lines.push('Optional details you may add:');
        for (const name of validation.missingOptional) {
            const description = context.describeArgument(name);
            const detail = buildOptionDetail(context, name);
            appendFieldGuidance(lines, description, detail);
        }
    }

    lines.push('Reply in natural language or type "cancel" to stop.');

    return lines.join('\n');
}

async function generateActionExplanation(context) {
    if (!context.llmAgent || typeof context.llmAgent.complete !== 'function') {
        return null;
    }

    const skillName = context.skill.name || '';
    const description = context.skill.description || '';
    const humanDescription = context.skill.humanDescription || '';
    const why = context.skill.why || '';
    const what = context.skill.what || '';

    // Only generate explanations for skills that explicitly opted in via needConfirmation: true
    // This indicates the skill is mutating and important enough to explain
    if (context.skill.needConfirmation !== true) {
        return null;
    }

    // Build argument summary
    const definitions = context.argumentDefinitions;
    const names = definitions.length ? definitions.map(def => def.name) : Object.keys(context.normalizedArgs);
    const argsSummary = [];

    for (const name of names) {
        const value = Object.prototype.hasOwnProperty.call(context.normalizedArgs, name)
            ? context.normalizedArgs[name]
            : undefined;
        if (value !== undefined && value !== null && value !== '') {
            const rendered = typeof context.presentValueAsync === 'function'
                ? await context.presentValueAsync(name, value)
                : context.presentValue(name, value);
            argsSummary.push(`${friendlyName(name)}: ${rendered}`);
        }
    }

    // Build a rich context for the LLM using all available skill metadata
    const skillContext = [
        skillName && `Skill: ${skillName}`,
        description && `Description: ${description}`,
        humanDescription && `Human description: ${humanDescription}`,
        why && `Why: ${why}`,
        what && `What: ${what}`
    ].filter(Boolean).join('\n');

    const prompt = `You are explaining an operation to a user who needs to understand what will happen.

${skillContext}

Parameters being provided:
${argsSummary.join('\n')}

Generate a clear, natural language explanation (2-3 sentences) that tells the user:
1. What this operation will do
2. What will be affected or changed
3. The key details based on the provided parameters

Use the skill's description and context to inform your explanation. Be concise, specific, and use natural language. Start directly with the explanation without preamble.`;

    try {
        const explanation = await context.llmAgent.complete({
            prompt,
            mode: 'fast',
            temperature: 0.3,
            context: { intent: 'action-explanation' }
        });

        if (explanation && typeof explanation === 'string' && explanation.trim()) {
            return explanation.trim();
        }
    } catch (error) {
        // If LLM fails, return null and fall back to standard narrative
        if (process.env.LLMAgentClient_DEBUG === 'true') {
            console.warn('Failed to generate action explanation:', error.message);
        }
    }

    return null;
}

async function buildNarrative(context) {
    const descriptor = context.skill.humanDescription || context.skill.description || `the skill ${context.skill.name}`;
    const lines = [];

    // Try to generate a detailed explanation for operations that need confirmation
    const actionExplanation = await generateActionExplanation(context);

    if (actionExplanation) {
        lines.push('📋 About to perform this action:');
        lines.push('');
        lines.push(actionExplanation);
        lines.push('');
    } else {
        lines.push(`About to apply ${descriptor}.`);
    }

    const definitions = context.argumentDefinitions;
    const names = definitions.length ? definitions.map(def => def.name) : Object.keys(context.normalizedArgs);

    if (!names.length) {
        lines.push('No arguments are configured.');
    } else {
        lines.push('Parameters:');
        for (const name of names) {
            const value = Object.prototype.hasOwnProperty.call(context.normalizedArgs, name)
                ? context.normalizedArgs[name]
                : undefined;
            const rendered = typeof context.presentValueAsync === 'function'
                ? await context.presentValueAsync(name, value)
                : context.presentValue(name, value);
            lines.push(`• ${friendlyName(name)}: ${rendered}`);
        }
    }

    lines.push('');
    lines.push('Confirm by replying "accept", "cancel", or describe any adjustments.');
    return lines.join('\n');
}

export {
    buildMissingMessage,
    buildNarrative,
};
