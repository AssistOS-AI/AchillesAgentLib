/**
 * List Skills - Returns all registered skills from the catalog
 */

import { Sanitiser } from '../../../utils/Sanitiser.mjs';

export async function action(input, context) {
    const { skilledAgent } = context;

    if (!skilledAgent || !skilledAgent.skillCatalog) {
        return 'Error: No skill catalog available';
    }

    // Parse filter from input
    let filter = null;
    if (typeof input === 'string' && input.trim()) {
        filter = input.trim().toLowerCase();
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
