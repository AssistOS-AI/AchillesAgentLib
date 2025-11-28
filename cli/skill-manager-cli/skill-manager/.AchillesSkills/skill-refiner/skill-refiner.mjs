/**
 * Skill Refiner - Iteratively improves skill definitions until requirements are met
 *
 * This orchestrator implements the loop:
 * read skill → generate code → test → evaluate → fix → repeat
 */

import fs from 'node:fs';
import path from 'node:path';
import { detectSkillType, parseSkillSections } from '../../skillSchemas.mjs';
import { buildEvaluationPrompt, buildFixesPrompt } from './skillRefiner.prompts.mjs';

/**
 * Parse input to extract skill name, requirements, and options
 */
function parseInput(input) {
    if (typeof input === 'string') {
        // Try to parse as JSON
        try {
            return JSON.parse(input);
        } catch (e) {
            // Treat as skill name with default options
            return { skillName: input.trim() };
        }
    }
    return input || {};
}

/**
 * Evaluate test results using LLM
 */
async function evaluateWithLLM(testResult, requirements, llmAgent) {
    const prompt = buildEvaluationPrompt(testResult, requirements);

    try {
        const response = await llmAgent.executePrompt(prompt, {
            responseShape: 'json',
            mode: 'fast',
        });

        if (typeof response === 'string') {
            return JSON.parse(response);
        }
        return response;
    } catch (error) {
        return {
            success: false,
            failures: [{ section: 'Evaluation', field: null, reason: error.message }],
            suggestions: ['Check LLM connectivity'],
        };
    }
}

/**
 * Generate section updates based on failures
 */
async function generateFixes(skillContent, failures, history, llmAgent) {
    const prompt = buildFixesPrompt(skillContent, failures, history);

    try {
        const response = await llmAgent.executePrompt(prompt, {
            responseShape: 'json',
            mode: 'deep',
        });

        if (typeof response === 'string') {
            return JSON.parse(response);
        }
        return response;
    } catch (error) {
        return {
            fixes: [],
            explanation: `Failed to generate fixes: ${error.message}`,
        };
    }
}

/**
 * Main action function for the skill refiner
 */
export async function action(input, context) {
    const { skillsDir, skilledAgent, llmAgent } = context;

    // Parse input
    const {
        skillName,
        requirements = {},
        maxIterations = 5,
        evaluator = 'llm',
    } = parseInput(input);

    if (!skillName) {
        return 'Error: skillName is required. Usage: skill-refiner {skillName, requirements?, maxIterations?}';
    }

    if (!llmAgent) {
        return 'Error: LLM agent not available for skill refinement';
    }

    // Find skill
    let skillRecord = skilledAgent?.getSkillRecord?.(skillName);
    let skillDir = skillRecord?.skillDir;
    let filePath = skillRecord?.filePath;

    if (!filePath && skillsDir) {
        skillDir = path.join(skillsDir, skillName);
        if (fs.existsSync(skillDir)) {
            const SKILL_FILES = ['tskill.md', 'cskill.md', 'iskill.md', 'oskill.md', 'mskill.md', 'skill.md'];
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

    const history = [];
    const output = [];

    output.push(`Starting refinement of "${skillName}"`);
    output.push(`Max iterations: ${maxIterations}`);
    output.push(`Requirements: ${JSON.stringify(requirements)}`);
    output.push('');

    for (let iteration = 0; iteration < maxIterations; iteration++) {
        output.push(`--- Iteration ${iteration + 1}/${maxIterations} ---`);

        // 1. Read current skill content
        let skillContent;
        try {
            skillContent = fs.readFileSync(filePath, 'utf8');
        } catch (error) {
            output.push(`Error reading skill: ${error.message}`);
            break;
        }

        const skillType = detectSkillType(skillContent);
        output.push(`Skill type: ${skillType}`);

        // 2. Generate code if tskill
        let generateResult = null;
        if (skillType === 'tskill') {
            output.push('Generating code...');
            try {
                // Use the generate-code skill
                const generateSkill = skilledAgent?.getSkillRecord?.('generate-code');
                if (generateSkill) {
                    generateResult = await skilledAgent.executePrompt(skillName, {
                        skillName: 'generate-code',
                        context,
                    });
                } else {
                    // Fallback: direct generation
                    output.push('(generate-code skill not found, skipping)');
                }
            } catch (error) {
                output.push(`Code generation error: ${error.message}`);
            }
        }

        // 3. Test the code
        let testResult = null;
        output.push('Testing code...');
        try {
            const testSkill = skilledAgent?.getSkillRecord?.('test-code');
            if (testSkill) {
                testResult = await skilledAgent.executePrompt(
                    JSON.stringify({ skillName, testInput: requirements.testInput }),
                    { skillName: 'test-code', context }
                );
            } else {
                testResult = 'Test skill not available';
            }
            output.push(`Test result: ${typeof testResult === 'string' ? testResult.slice(0, 200) : 'OK'}`);
        } catch (error) {
            testResult = `Test error: ${error.message}`;
            output.push(testResult);
        }

        // 4. Evaluate results
        output.push('Evaluating results...');
        const evaluation = await evaluateWithLLM(testResult, requirements, llmAgent);

        history.push({
            iteration,
            skillContent,
            testResult,
            evaluation,
        });

        // 5. Check for success
        if (evaluation.success) {
            output.push('SUCCESS: Requirements met!');
            output.push('');
            return {
                success: true,
                iterations: iteration + 1,
                output: output.join('\n'),
                history,
            };
        }

        output.push(`Failures: ${evaluation.failures?.length || 0}`);
        evaluation.failures?.forEach(f => {
            output.push(`  - ${f.section || 'Unknown'}: ${f.reason}`);
        });

        // 6. Check if last iteration
        if (iteration >= maxIterations - 1) {
            output.push('Max iterations reached');
            break;
        }

        // 7. Generate and apply fixes
        output.push('Generating fixes...');
        const fixes = await generateFixes(skillContent, evaluation.failures, history, llmAgent);

        if (!fixes.fixes || fixes.fixes.length === 0) {
            output.push('No fixes generated, stopping');
            break;
        }

        output.push(`Applying ${fixes.fixes.length} fix(es)...`);
        for (const fix of fixes.fixes) {
            if (fix.section && fix.content) {
                // Apply fix using update-section logic
                const { updateSkillSection } = await import('../../skillSchemas.mjs');
                skillContent = updateSkillSection(skillContent, fix.section, fix.content);
                output.push(`  - Fixed: ${fix.section}`);
            }
        }

        // Write updated content
        try {
            fs.writeFileSync(filePath, skillContent, 'utf8');
            output.push('Updated skill file');
        } catch (error) {
            output.push(`Error writing fixes: ${error.message}`);
            break;
        }

        output.push('');
    }

    return {
        success: false,
        iterations: history.length,
        reason: 'max_iterations_reached',
        output: output.join('\n'),
        history,
    };
}

export default action;
