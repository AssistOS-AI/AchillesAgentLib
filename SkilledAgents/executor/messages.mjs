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

    const promptOnlyRequired = Boolean(context?.skill?.promptOnlyRequiredArguments);
    const hasOptional = validation.missingOptional.length && !promptOnlyRequired;

    if (validation.missingRequired.length || hasOptional) {
        lines.push('📋 Please provide the following details:');
        lines.push('');

        // Table formatting helpers
        const ARG_WIDTH = 25;
        const STATUS_WIDTH = 12;
        const OPTIONS_WIDTH = 45;

        function padRight(text, length) {
            return String(text).padEnd(length, ' ');
        }

        // Build table header
        lines.push(`| ${padRight('Argument', ARG_WIDTH)} | ${padRight('Required', STATUS_WIDTH)} | ${padRight('Choices', OPTIONS_WIDTH)} |`);
        lines.push(`|${'-'.repeat(ARG_WIDTH + 2)}|${'-'.repeat(STATUS_WIDTH + 2)}|${'-'.repeat(OPTIONS_WIDTH + 2)}|`);

        // Add required fields
        for (const name of validation.missingRequired) {
            const description = context.describeArgument(name);
            const detail = buildOptionDetail(context, name);

            // Format options - each on a new line
            let optionsLines = [];
            if (detail.labels.length > 0 && detail.enumerated) {
                // Show first few options, each on its own line
                const displayOptions = detail.labels.slice(0, 5);
                optionsLines = displayOptions.map(opt => `• ${opt}`);
                if (detail.totalCount > 5) {
                    optionsLines.push(`  (+${detail.totalCount - 5} more)`);
                }
            } else {
                // No predefined options
                optionsLines = ['—'];
            }

            // Print first line with parameter info
            lines.push(`| ${padRight(friendlyName(name), ARG_WIDTH)} | ${padRight('Required', STATUS_WIDTH)} | ${padRight(optionsLines[0] || '—', OPTIONS_WIDTH)} |`);
            // Print additional option lines
            for (let i = 1; i < optionsLines.length; i++) {
                lines.push(`| ${padRight('', ARG_WIDTH)} | ${padRight('', STATUS_WIDTH)} | ${padRight(optionsLines[i], OPTIONS_WIDTH)} |`);
            }
        }

        // Add optional fields
        if (hasOptional) {
            for (const name of validation.missingOptional) {
                const description = context.describeArgument(name);
                const detail = buildOptionDetail(context, name);

                // Format options - each on a new line
                let optionsLines = [];
                if (detail.labels.length > 0 && detail.enumerated) {
                    // Show first few options, each on its own line
                    const displayOptions = detail.labels.slice(0, 5);
                    optionsLines = displayOptions.map(opt => `• ${opt}`);
                    if (detail.totalCount > 5) {
                        optionsLines.push(`  (+${detail.totalCount - 5} more)`);
                    }
                } else {
                    // No predefined options
                    optionsLines = ['—'];
                }

                // Print first line with parameter info
                lines.push(`| ${padRight(friendlyName(name), ARG_WIDTH)} | ${padRight('Optional', STATUS_WIDTH)} | ${padRight(optionsLines[0] || '—', OPTIONS_WIDTH)} |`);
                // Print additional option lines
                for (let i = 1; i < optionsLines.length; i++) {
                    lines.push(`| ${padRight('', ARG_WIDTH)} | ${padRight('', STATUS_WIDTH)} | ${padRight(optionsLines[i], OPTIONS_WIDTH)} |`);
                }
            }
        }

        lines.push('');
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

    // Table formatting helpers
    const FIELD_WIDTH = 30;
    const VALUE_WIDTH = 45;

    function padRight(text, length) {
        return String(text).padEnd(length, ' ');
    }

    const definitions = context.argumentDefinitions;
    let names = definitions.length ? definitions.map(def => def.name) : Object.keys(context.normalizedArgs);

    // Reorder names to put ID fields first
    const idFields = names.filter(name =>
        name.endsWith('_id') ||
        name === 'id' ||
        name.toLowerCase().includes('_id')
    );
    const nonIdFields = names.filter(name =>
        !name.endsWith('_id') &&
        name !== 'id' &&
        !name.toLowerCase().includes('_id')
    );
    names = [...idFields, ...nonIdFields];

    // Build table header
    lines.push(`📋 About to perform: ${descriptor}`);
    lines.push('');

    if (!names.length) {
        lines.push('No parameters configured.');
    } else {
        lines.push(`| ${padRight('Parameter', FIELD_WIDTH)} | ${padRight('Value', VALUE_WIDTH)} |`);
        lines.push(`|${'-'.repeat(FIELD_WIDTH + 2)}|${'-'.repeat(VALUE_WIDTH + 2)}|`);

        for (const name of names) {
            const value = Object.prototype.hasOwnProperty.call(context.normalizedArgs, name)
                ? context.normalizedArgs[name]
                : undefined;
            const rendered = typeof context.presentValueAsync === 'function'
                ? await context.presentValueAsync(name, value)
                : context.presentValue(name, value);
            lines.push(`| ${padRight(friendlyName(name), FIELD_WIDTH)} | ${padRight(rendered || '—', VALUE_WIDTH)} |`);
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
