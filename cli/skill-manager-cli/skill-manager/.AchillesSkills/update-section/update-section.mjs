/**
 * Update Section - Updates a specific section in a skill definition file
 * Automatically triggers code regeneration if a .generated.mjs file exists
 */

import fs from 'node:fs';
import path from 'node:path';
import { updateSkillSection } from '../../skillSchemas.mjs';

/**
 * Check if a .generated.mjs file exists in the skill directory
 */
function hasGeneratedCode(skillDir) {
    if (!skillDir || !fs.existsSync(skillDir)) return false;
    const files = fs.readdirSync(skillDir);
    return files.some(f => f.endsWith('.generated.mjs') || f.endsWith('.generated.js'));
}

/**
 * Trigger code regeneration for the skill
 */
async function triggerCodeRegeneration(skillName, context) {
    try {
        // Dynamically import generate-code to avoid circular dependencies
        const generateCodeModule = await import('../generate-code/generate-code.mjs');
        const generateAction = generateCodeModule.action || generateCodeModule.default;

        if (typeof generateAction === 'function') {
            const result = await generateAction(skillName, context);
            return { success: true, result };
        }
        return { success: false, error: 'generate-code action not found' };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

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

    // Determine skill directory
    const skillDir = path.dirname(filePath);

    try {
        fs.writeFileSync(filePath, updatedContent, 'utf8');

        const messages = [`Updated section "## ${section}" in ${skillName}`];

        // Check if code regeneration is needed
        if (hasGeneratedCode(skillDir)) {
            messages.push('');
            messages.push('Detected existing generated code. Triggering regeneration...');

            const regenResult = await triggerCodeRegeneration(skillName, context);

            if (regenResult.success) {
                messages.push(`Code regenerated successfully.`);
                if (typeof regenResult.result === 'string' && regenResult.result.includes('Generated:')) {
                    // Extract just the relevant info
                    const match = regenResult.result.match(/Generated: (.+\.mjs)/);
                    if (match) {
                        messages.push(`Output: ${match[1]}`);
                    }
                }
            } else {
                messages.push(`Warning: Code regeneration failed: ${regenResult.error}`);
                messages.push('You may need to run "generate code" manually.');
            }
        }

        messages.push('');
        messages.push('Remember to reload skills after changes.');

        return messages.join('\n');
    } catch (error) {
        return `Error writing file: ${error.message}`;
    }
}

export default action;
