/**
 * Read Skill - Reads a skill definition file
 */

import fs from 'node:fs';
import path from 'node:path';

export async function action(input, context) {
    const { skillsDir, skilledAgent } = context;

    // Parse skill name from input
    let skillName = null;
    if (typeof input === 'string') {
        try {
            const parsed = JSON.parse(input);
            skillName = parsed.skillName || parsed.name;
        } catch (e) {
            // Not JSON, treat as string
            skillName = input.trim();
        }
    } else if (input && typeof input === 'object') {
        skillName = input.skillName || input.name;
    }

    if (!skillName) {
        return 'Error: skillName is required. Usage: read-skill <skillName>';
    }

    // Try to find skill in catalog first
    const skillRecord = skilledAgent?.getSkillRecord?.(skillName);
    if (skillRecord && skillRecord.filePath) {
        try {
            const content = fs.readFileSync(skillRecord.filePath, 'utf8');
            return `=== ${path.basename(skillRecord.filePath)} ===\nPath: ${skillRecord.filePath}\nType: ${skillRecord.type}\n\n${content}`;
        } catch (error) {
            return `Error reading skill file: ${error.message}`;
        }
    }

    // Fallback: look in skillsDir
    if (!skillsDir) {
        return `Error: Skill "${skillName}" not found in catalog and no skillsDir configured`;
    }

    const skillDir = path.join(skillsDir, skillName);
    if (!fs.existsSync(skillDir)) {
        // List available skills
        let available = [];
        try {
            available = fs.readdirSync(skillsDir)
                .filter(f => fs.statSync(path.join(skillsDir, f)).isDirectory());
        } catch (e) {
            // Ignore
        }
        return `Error: Skill "${skillName}" not found.\nAvailable skills: ${available.join(', ') || 'none'}`;
    }

    // Find skill definition file
    const SKILL_FILES = ['skill.md', 'cskill.md', 'iskill.md', 'oskill.md', 'mskill.md', 'tskill.md'];
    let foundFile = null;

    try {
        const files = fs.readdirSync(skillDir);
        foundFile = files.find(f => SKILL_FILES.includes(f));
    } catch (error) {
        return `Error reading skill directory: ${error.message}`;
    }

    if (!foundFile) {
        return `Error: No skill definition file found in ${skillName}`;
    }

    const filePath = path.join(skillDir, foundFile);
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        return `=== ${foundFile} ===\nPath: ${filePath}\n\n${content}`;
    } catch (error) {
        return `Error reading file: ${error.message}`;
    }
}

export default action;
