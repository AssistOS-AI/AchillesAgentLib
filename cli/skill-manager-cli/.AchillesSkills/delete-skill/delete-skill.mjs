/**
 * Delete Skill - Removes a skill directory
 */

import fs from 'node:fs';
import path from 'node:path';

export async function action(input, context) {
    const { skillsDir } = context;

    if (!skillsDir) {
        return 'Error: skillsDir not configured in context';
    }

    // Parse skill name
    let skillName = null;
    if (typeof input === 'string' && input.trim()) {
        skillName = input.trim();
    } else if (input && typeof input === 'object') {
        skillName = input.skillName || input.name;
    }

    if (!skillName) {
        return 'Error: skillName is required. Usage: delete-skill <skillName>';
    }

    const skillDir = path.join(skillsDir, skillName);

    if (!fs.existsSync(skillDir)) {
        return `Error: Skill "${skillName}" not found at ${skillDir}`;
    }

    // List files that will be deleted
    let files = [];
    try {
        files = fs.readdirSync(skillDir);
    } catch (error) {
        return `Error reading skill directory: ${error.message}`;
    }

    try {
        fs.rmSync(skillDir, { recursive: true, force: true });
        return `Deleted skill: ${skillName}\nRemoved ${files.length} file(s): ${files.join(', ')}\n\nRemember to reload skills after deletion.`;
    } catch (error) {
        return `Error deleting skill: ${error.message}`;
    }
}

export default action;
