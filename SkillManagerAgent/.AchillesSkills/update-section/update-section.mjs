/**
 * Update Section - Updates a specific section in a skill definition file
 */

import fs from 'node:fs';
import path from 'node:path';
import { updateSkillSection } from '../../skillSchemas.mjs';

export async function action(input, context) {
    const { skillsDir, skilledAgent } = context;

    // Parse arguments
    let args;
    if (typeof input === 'string') {
        try {
            args = JSON.parse(input);
        } catch (e) {
            return `Error: Invalid JSON input. Expected: {skillName, section, content}`;
        }
    } else {
        args = input || {};
    }

    const { skillName, section, content: newContent } = args;

    if (!skillName) {
        return 'Error: skillName is required';
    }
    if (!section) {
        return 'Error: section is required (e.g., "Summary", "Instructions")';
    }
    if (newContent === undefined || newContent === null) {
        return 'Error: content is required';
    }

    // Find skill file
    let filePath = null;

    const skillRecord = skilledAgent?.getSkillRecord?.(skillName);
    if (skillRecord && skillRecord.filePath) {
        filePath = skillRecord.filePath;
    } else if (skillsDir) {
        const skillDir = path.join(skillsDir, skillName);
        if (fs.existsSync(skillDir)) {
            const SKILL_FILES = ['skill.md', 'cskill.md', 'iskill.md', 'oskill.md', 'mskill.md', 'tskill.md'];
            const files = fs.readdirSync(skillDir);
            const skillFile = files.find(f => SKILL_FILES.includes(f));
            if (skillFile) {
                filePath = path.join(skillDir, skillFile);
            }
        }
    }

    if (!filePath) {
        return `Error: Skill "${skillName}" not found`;
    }

    let currentContent;
    try {
        currentContent = fs.readFileSync(filePath, 'utf8');
    } catch (error) {
        return `Error reading skill file: ${error.message}`;
    }

    // Update section
    const updatedContent = updateSkillSection(currentContent, section, newContent);

    try {
        fs.writeFileSync(filePath, updatedContent, 'utf8');
        return `Updated section "## ${section}" in ${skillName}\n\nRemember to reload skills and validate after changes.`;
    } catch (error) {
        return `Error writing file: ${error.message}`;
    }
}

export default action;
