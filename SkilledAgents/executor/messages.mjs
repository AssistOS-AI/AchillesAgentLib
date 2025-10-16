import { friendlyName } from './context.mjs';

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

function buildMissingMessage(context, validation) {
    const lines = [];

    if (validation.invalid.length) {
        lines.push(`Ignored values for ${joinList(validation.invalid.map(friendlyName))} because they did not match the expected format.`);
    }

    if (validation.missingRequired.length) {
        lines.push('To continue I need the following details:');
        for (const name of validation.missingRequired) {
            const description = context.describeArgument(name);
            const detail = typeof context.getOptionSamplesDetailed === 'function'
                ? context.getOptionSamplesDetailed(name, 10)
                : { labels: context.getOptionSamples(name, 10), totalCount: (context.getOptionSamples(name, 10) || []).length };
            if (detail.labels.length) {
                const suffix = detail.totalCount > 10 ? ` (showing 10 of ${detail.totalCount})` : '';
                lines.push(`• ${description}. For example: ${detail.labels.join(', ')}${suffix}`);
            } else {
                lines.push(`• ${description}.`);
            }
        }
    }

    if (validation.missingOptional.length) {
        const optionalDescriptions = [];
        for (const name of validation.missingOptional) {
            const description = context.describeArgument(name);
            const detail = typeof context.getOptionSamplesDetailed === 'function'
                ? context.getOptionSamplesDetailed(name, 10)
                : { labels: context.getOptionSamples(name, 10), totalCount: (context.getOptionSamples(name, 10) || []).length };
            if (detail.labels.length) {
                const suffix = detail.totalCount > 10 ? ` (showing 10 of ${detail.totalCount})` : '';
                optionalDescriptions.push(`${description}. For example: ${detail.labels.join(', ')}${suffix}`);
            } else {
                optionalDescriptions.push(description);
            }
        }
        lines.push(`Optional details you may add: ${joinList(optionalDescriptions)}.`);
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
