/**
 * Write Skill - Creates or updates a skill definition file
 */

import fs from 'node:fs';
import path from 'node:path';

export async function action(input, context) {
    const { skillsDir, skilledAgent } = context;

    if (!skillsDir) {
        return 'Error: skillsDir not configured in context';
    }

    // Parse arguments
    let args;
    if (typeof input === 'string') {
        try {
            args = JSON.parse(input);
        } catch (e) {
            return `Error: Invalid JSON input. Expected: {skillName, fileName, content}. Got: ${input.slice(0, 100)}`;
        }
    } else {
        args = input || {};
    }

    const { skillName, fileName, content } = args;

    if (!skillName) {
        return 'Error: skillName is required';
    }
    if (!fileName) {
        return 'Error: fileName is required (e.g., cskill.md, tskill.md)';
    }
    if (content === undefined || content === null) {
        return 'Error: content is required';
    }

    // Validate fileName
    const validFileNames = ['skill.md', 'cskill.md', 'iskill.md', 'oskill.md', 'mskill.md', 'tskill.md'];
    const isSkillFile = validFileNames.includes(fileName) || fileName.endsWith('.mjs') || fileName.endsWith('.js');
    if (!isSkillFile) {
        return `Warning: "${fileName}" is not a standard skill file. Valid skill files: ${validFileNames.join(', ')}`;
    }

    const skillDir = path.join(skillsDir, skillName);
    const filePath = path.join(skillDir, fileName);

    try {
        // Create directory if needed
        if (!fs.existsSync(skillDir)) {
            fs.mkdirSync(skillDir, { recursive: true });
        }

        // Check if file exists (for messaging)
        const existed = fs.existsSync(filePath);

        // Write file
        fs.writeFileSync(filePath, content, 'utf8');

        const action = existed ? 'Updated' : 'Created';

        // Auto-reload skills so the new skill is immediately available
        let reloadMessage = '';
        if (skilledAgent && typeof skilledAgent.reloadSkills === 'function') {
            try {
                const count = skilledAgent.reloadSkills();
                reloadMessage = `\nSkills reloaded (${count} skill(s) registered).`;
            } catch (e) {
                reloadMessage = '\nNote: Could not auto-reload skills. Use "reload" command.';
            }
        }

        return `${action}: ${skillName}/${fileName} (${content.length} bytes)${reloadMessage}`;
    } catch (error) {
        return `Error writing file: ${error.message}`;
    }
}

export default action;
