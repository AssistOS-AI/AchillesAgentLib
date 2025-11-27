/**
 * Get Template - Returns a blank template for a skill type
 */

import { SKILL_TYPES, SKILL_TEMPLATES } from '../../skillSchemas.mjs';

export async function action(input, context) {
    // Parse skill type
    let skillType = null;
    if (typeof input === 'string' && input.trim()) {
        skillType = input.trim().toLowerCase();
    } else if (input && typeof input === 'object') {
        skillType = (input.skillType || input.type || '').toLowerCase();
    }

    const availableTypes = Object.keys(SKILL_TEMPLATES);

    if (!skillType) {
        return `Error: skillType is required.\nAvailable types: ${availableTypes.join(', ')}`;
    }

    const template = SKILL_TEMPLATES[skillType];
    if (!template) {
        return `Error: Unknown skill type "${skillType}".\nAvailable types: ${availableTypes.join(', ')}`;
    }

    const schema = SKILL_TYPES[skillType] || {};

    const output = [];
    output.push(`=== Template: ${skillType} (${schema.fileName || skillType + '.md'}) ===`);
    output.push(`Description: ${schema.description || 'No description'}`);
    output.push(`Required sections: ${(schema.requiredSections || []).join(', ') || 'None'}`);
    output.push(`Optional sections: ${(schema.optionalSections || []).join(', ') || 'None'}`);
    output.push('');
    output.push('--- TEMPLATE START ---');
    output.push(template);
    output.push('--- TEMPLATE END ---');

    return output.join('\n');
}

export default action;
