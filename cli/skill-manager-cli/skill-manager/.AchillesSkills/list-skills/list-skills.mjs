/**
 * List Skills - Returns all registered skills from the catalog
 */

import { Sanitiser } from '../../../../../utils/Sanitiser.mjs';

export async function action(input, context) {
    const { skilledAgent } = context;

    if (!skilledAgent || !skilledAgent.skillCatalog) {
        return 'Error: No skill catalog available';
    }

    // Parse filter from input
    let filter = null;

    // Phrases that should NOT be treated as filters
    const ignorePatterns = [
        'list skills', 'list all skills', 'show skills', 'show all skills',
        'get skills', 'skills', 'all', 'all skills', 'list', 'show',
    ];

    // If input looks like a full command/sentence (has spaces and multiple words), ignore it as a filter
    const looksLikeCommand = (str) => {
        const words = str.split(/\s+/).length;
        return words > 3 || str.includes('"') || str.includes("'");
    };

    if (typeof input === 'string' && input.trim()) {
        const trimmed = input.trim().toLowerCase();
        // Only use as filter if it's not a common command phrase or full command
        if (!ignorePatterns.includes(trimmed) && !looksLikeCommand(trimmed)) {
            filter = trimmed;
        }
    } else if (input && typeof input === 'object' && input.filter) {
        filter = input.filter.toLowerCase();
    }

    const skills = Array.from(skilledAgent.skillCatalog.values());

    if (skills.length === 0) {
        return 'No skills currently registered. Create one with write-skill or use get-template.';
    }

    // Apply filter if provided
    const filtered = filter
        ? skills.filter(s => s.type === filter || s.type.includes(filter))
        : skills;

    if (filtered.length === 0) {
        return `No skills found matching filter: "${filter}"\nAvailable types: ${[...new Set(skills.map(s => s.type))].join(', ')}`;
    }

    // Format output
    const output = filtered.map(s => {
        const toolName = `execute_${Sanitiser.sanitiseName(s.name).replace(/-/g, '_')}`;
        return [
            `[${s.type}] ${s.shortName || s.name}`,
            `   Summary: ${s.descriptor?.summary || 'No summary'}`,
            `   Path: ${s.skillDir || 'unknown'}`,
        ].join('\n');
    });

    const header = filter
        ? `Found ${filtered.length} skill(s) matching "${filter}":`
        : `Found ${filtered.length} skill(s):`;

    return `${header}\n\n${output.join('\n\n')}`;
}

export default action;
