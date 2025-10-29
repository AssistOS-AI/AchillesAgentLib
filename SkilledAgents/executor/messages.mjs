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

    if (validation.missingOptional.length) {
        lines.push('Optional details you may add:');
        for (const name of validation.missingOptional) {
            const description = context.describeArgument(name);
            const detail = buildOptionDetail(context, name);
            appendFieldGuidance(lines, description, detail);
        }
    }

    lines.push('Reply in natural language (e.g. "high priority and approved status") or type "cancel" to stop.');

    return lines.join('\n');
}

async function buildNarrative(context) {
    const descriptor = context.skill.humanDescription || context.skill.description || `the skill ${context.skill.name}`;
    const lines = [`About to apply ${descriptor}.`];
    const definitions = context.argumentDefinitions;
    const names = definitions.length ? definitions.map(def => def.name) : Object.keys(context.normalizedArgs);

    if (!names.length) {
        lines.push('No arguments are configured.');
    } else {
        lines.push('We will use the following values:');
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

    lines.push('Confirm by replying "accept", "cancel", or describe any adjustments.');
    return lines.join('\n');
}

export {
    buildMissingMessage,
    buildNarrative,
};
