/**
 * Validate Skill - Validates a skill file against its schema
 */

import fs from 'node:fs';
import path from 'node:path';
import { validateSkillContent, detectSkillType } from '../../skillSchemas.mjs';

export async function action(input, context) {
    const { skillsDir, skilledAgent } = context;

    // Parse skill name
    let skillName = null;
    if (typeof input === 'string') {
        try {
            const parsed = JSON.parse(input);
            skillName = parsed.skillName || parsed.name;
        } catch (e) {
            skillName = input.trim();
        }
    } else if (input && typeof input === 'object') {
        skillName = input.skillName || input.name;
    }

    if (!skillName) {
        return 'Error: skillName is required. Usage: validate-skill <skillName>';
    }

    // Find skill file
    let filePath = null;
    let content = null;

    // Try catalog first
    const skillRecord = skilledAgent?.getSkillRecord?.(skillName);
    if (skillRecord && skillRecord.filePath) {
        filePath = skillRecord.filePath;
    } else if (skillsDir) {
        // Fallback to skillsDir
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

    try {
        content = fs.readFileSync(filePath, 'utf8');
    } catch (error) {
        return `Error reading skill file: ${error.message}`;
    }

    // Validate
    const result = validateSkillContent(content);

    const output = [];
    output.push(`Validation: ${skillName}`);
    output.push(`File: ${path.basename(filePath)}`);
    output.push(`Detected Type: ${result.detectedType || 'unknown'}`);
    output.push(`Status: ${result.valid ? 'VALID' : 'INVALID'}`);

    if (result.errors && result.errors.length > 0) {
        output.push('\nErrors:');
        result.errors.forEach(e => output.push(`  - ${e}`));
    }

    if (result.warnings && result.warnings.length > 0) {
        output.push('\nWarnings:');
        result.warnings.forEach(w => output.push(`  - ${w}`));
    }

    if (result.valid && (!result.warnings || result.warnings.length === 0)) {
        output.push('\nNo issues found.');
    }

    return output.join('\n');
}

export default action;
