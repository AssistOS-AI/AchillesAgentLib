/**
 * Test Code - Tests generated code by importing and running it
 */

import fs from 'node:fs';
import path from 'node:path';

export async function action(input, context) {
    const { skillsDir, skilledAgent } = context;

    // Parse arguments
    let skillName = null;
    let testInput = undefined;

    if (typeof input === 'string') {
        try {
            const parsed = JSON.parse(input);
            skillName = parsed.skillName || parsed.name;
            testInput = parsed.testInput;
        } catch (e) {
            // Treat as plain skill name
            skillName = input.trim();
        }
    } else if (input && typeof input === 'object') {
        skillName = input.skillName || input.name;
        testInput = input.testInput;
    }

    if (!skillName) {
        return 'Error: skillName is required. Usage: test-code <skillName> or {skillName, testInput}';
    }

    // Find generated file
    let generatedFile = null;
    let skillDir = null;

    const skillRecord = skilledAgent?.getSkillRecord?.(skillName);
    if (skillRecord && skillRecord.skillDir) {
        skillDir = skillRecord.skillDir;
    } else if (skillsDir) {
        skillDir = path.join(skillsDir, skillName);
    }

    if (!skillDir || !fs.existsSync(skillDir)) {
        return `Error: Skill directory not found for "${skillName}"`;
    }

    // Look for generated files - all types use .generated.mjs convention
    const files = fs.readdirSync(skillDir);
    generatedFile = files.find(f =>
        f.endsWith('.generated.mjs') ||
        f.endsWith('.generated.js')
    );

    if (!generatedFile) {
        return `Error: No generated code found for "${skillName}".\nRun generate-code first.`;
    }

    const fullPath = path.join(skillDir, generatedFile);

    try {
        // Add timestamp to bust cache
        const moduleUrl = `file://${fullPath}?t=${Date.now()}`;
        const module = await import(moduleUrl);

        const output = [];
        output.push(`Module loaded: ${generatedFile}`);
        output.push('');
        output.push('Exports:');

        const results = [];

        for (const [name, value] of Object.entries(module)) {
            if (name === 'default') continue;

            const type = typeof value;
            if (type === 'function') {
                output.push(`  - ${name}(): function`);

                // Try to execute with test input if provided
                if (testInput !== undefined) {
                    try {
                        const result = await value(testInput);
                        const resultStr = typeof result === 'string'
                            ? result
                            : JSON.stringify(result);
                        const preview = resultStr.length > 100
                            ? resultStr.slice(0, 100) + '...'
                            : resultStr;
                        results.push(`    ${name}(testInput) = ${preview}`);
                    } catch (e) {
                        results.push(`    ${name}(testInput) ERROR: ${e.message}`);
                    }
                }
            } else {
                output.push(`  - ${name}: ${type}`);
            }
        }

        if (results.length > 0) {
            output.push('');
            output.push('Test Results:');
            output.push(...results);
        }

        return output.join('\n');
    } catch (error) {
        return [
            `Failed to load module: ${error.message}`,
            '',
            'This usually means there is a syntax error in the generated code.',
            'Check the generated file or regenerate it.',
            '',
            'Stack trace:',
            error.stack,
        ].join('\n');
    }
}

export default action;
