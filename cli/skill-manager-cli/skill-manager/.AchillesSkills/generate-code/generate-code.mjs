/**
 * Generate Code - Generates .mjs code from skill definitions (tskill, iskill, oskill, cskill)
 */

import fs from 'node:fs';
import path from 'node:path';
import { detectSkillType, parseSkillSections } from '../../skillSchemas.mjs';
import {
    buildCodeGenPrompt,
    buildIskillCodeGenPrompt,
    buildOskillCodeGenPrompt,
    buildCskillCodeGenPrompt,
} from './codeGeneration.prompts.mjs';

const SUPPORTED_TYPES = ['tskill', 'iskill', 'oskill', 'cskill'];

export async function action(input, context) {
    const { skillsDir, llmAgent, skilledAgent } = context;

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
        return 'Error: skillName is required. Usage: generate-code <skillName>';
    }

    // Find skill file
    let filePath = null;
    let skillDir = null;

    const skillRecord = skilledAgent?.getSkillRecord?.(skillName);
    if (skillRecord && skillRecord.filePath) {
        filePath = skillRecord.filePath;
        skillDir = skillRecord.skillDir;
    } else if (skillsDir) {
        skillDir = path.join(skillsDir, skillName);
        if (fs.existsSync(skillDir)) {
            const files = fs.readdirSync(skillDir);
            // Look for any supported skill definition file
            const skillFile = files.find(f =>
                f === 'tskill.md' || f === 'iskill.md' || f === 'oskill.md' || f === 'cskill.md'
            );
            if (skillFile) {
                filePath = path.join(skillDir, skillFile);
            }
        }
    }

    if (!filePath) {
        return `Error: Skill "${skillName}" not found`;
    }

    let content;
    try {
        content = fs.readFileSync(filePath, 'utf8');
    } catch (error) {
        return `Error reading skill file: ${error.message}`;
    }

    // Verify it's a supported type
    const skillType = detectSkillType(content);
    if (!SUPPORTED_TYPES.includes(skillType)) {
        return `Error: Code generation is only supported for: ${SUPPORTED_TYPES.join(', ')}.\nThis skill is type: ${skillType || 'unknown'}`;
    }

    if (!llmAgent || typeof llmAgent.executePrompt !== 'function') {
        return 'Error: LLM agent not available for code generation';
    }

    // Parse sections for context
    const sections = parseSkillSections(content);

    // Generate code using LLM with appropriate prompt based on skill type
    let prompt;
    switch (skillType) {
        case 'tskill':
            prompt = buildCodeGenPrompt(skillName, content, sections);
            break;
        case 'iskill':
            prompt = buildIskillCodeGenPrompt(skillName, content, sections);
            break;
        case 'oskill':
            prompt = buildOskillCodeGenPrompt(skillName, content, sections);
            break;
        case 'cskill':
            prompt = buildCskillCodeGenPrompt(skillName, content, sections);
            break;
        default:
            return `Error: No code generation prompt for skill type: ${skillType}`;
    }

    try {
        let generatedCode = await llmAgent.executePrompt(prompt, {
            responseShape: 'code',
            mode: 'deep',
        });

        // Clean up response - remove markdown code blocks if present
        if (typeof generatedCode === 'string') {
            generatedCode = generatedCode
                .replace(/^```(?:javascript|js|mjs)?\n?/i, '')
                .replace(/\n?```$/i, '')
                .trim();
        }

        if (!generatedCode || typeof generatedCode !== 'string') {
            return 'Error: LLM returned empty or invalid code';
        }

        // Write the generated file - all types use .generated.mjs convention
        // tskill uses tskill.generated.mjs, others use skillName.generated.mjs
        const outFileName = skillType === 'tskill'
            ? 'tskill.generated.mjs'
            : `${skillName}.generated.mjs`;
        const outPath = path.join(skillDir, outFileName);

        fs.writeFileSync(outPath, generatedCode, 'utf8');

        return [
            `Generated: ${outFileName}`,
            `Path: ${outPath}`,
            `Size: ${generatedCode.length} bytes`,
            '',
            'Use test-code to verify the generated code works correctly.',
        ].join('\n');
    } catch (error) {
        return `Error generating code: ${error.message}`;
    }
}

export default action;
