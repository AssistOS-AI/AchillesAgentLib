import fs from 'node:fs/promises';
import path from 'node:path';
import { getDebugLogger } from '../../utils/DebugLogger.mjs';
import {
    backupSpecsDirectory,
    extractTestingSection,
    findExistingCodeFiles,
    findSpecFiles,
    normalizeGeneratedPath,
    specPathToTarget,
} from './spec-utils.mjs';
import { parseMultiFileMarkdown } from './llm-utils.mjs';
import {
    generateBehaviorTests,
    generateBehaviorTestsFromSection,
    repairGeneratedFile,
    reviewGeneratedCodeWithTests,
    runBehaviorTestsInTemp,
    validateOrRepairGeneratedCode,
} from './testing.mjs';

/**
 * Short name identifier for this internal skill.
 */
export const shortName = 'mirror-code-generator';

/**
 * Descriptor metadata for this internal skill.
 */
export const descriptor = {
    title: 'Mirror Code Generator',
    summary: 'Generates JavaScript/ESM code from specs/ directory markdown files.',
    sections: {},
};

/**
 * Orchestrator skill action entry point.
 * @param {Object} context - Execution context provided by OrchestratorSkillsSubsystem.
 * @param {string} context.prompt - The skill directory path to generate code for.
 * @param {Object} context.recursiveAgent - The recursive agent instance (provides llmAgent).
 * @param {Object} context.llmAgent - The LLM agent instance.
 * @returns {Promise<Object>} Result object with message and generatedFiles array.
 */
export async function action(context) {
    const { prompt, recursiveAgent, llmAgent } = context;
    const targetDir = prompt?.trim();

    if (!targetDir) {
        throw new Error('mirror-code-generator requires a skill directory path as input.');
    }

    const agent = llmAgent || recursiveAgent?.llmAgent;
    if (!agent) {
        throw new Error('mirror-code-generator requires an LLM agent.');
    }

    const generatedFiles = await generateMirrorCode(targetDir, agent, console);

    return {
        message: `Code generation completed for ${targetDir}`,
        generatedFiles: generatedFiles || [],
    };
}

/**
 * Generate code from a specs directory into the source root.
 * @param {string} sourcePath - Directory containing specs/.
 * @param {object} llmAgent - LLM agent instance to use for generation.
 * @param {object} [logger=console] - Logger instance.
 * @returns {Promise<string[]>} Array of generated file paths (relative to sourcePath), or empty array if skipped/up-to-date.
 */
export async function generateMirrorCode(sourcePath, llmAgent, logger = console) {
    const debugLogger = getDebugLogger();
    const specsDir = path.join(sourcePath, 'specs');
    const backupSpecsDir = path.join(specsDir, '.backup');
    const sourceName = path.basename(sourcePath);

    try {
        const specsDirExists = await fs.stat(specsDir).then(stat => stat.isDirectory()).catch(() => false);
        if (!specsDirExists) {
            debugLogger?.log('generateMirrorCode:skip', { skill: sourceName, reason: 'No specs directory found.' });
            return [];
        }

        const specFiles = await findSpecFiles(specsDir);
        if (specFiles.length === 0) {
            logger.warn(`[generateMirrorCode] No spec files found in ${specsDir} for "${sourceName}".`);
            return [];
        }

        const backupSpecsExists = await fs.stat(backupSpecsDir).then(stat => stat.isDirectory()).catch(() => false);
        const specEntries = [];
        let anyNeedsRegeneration = false;

        for (const specFile of specFiles) {
            const targetPath = specPathToTarget(specFile.relativePath);
            let needsRegeneration = false;
            try {
                const specStats = await fs.stat(specFile.absolutePath);
                const outputStats = await fs.stat(path.join(sourcePath, targetPath));
                if (specStats.mtimeMs > outputStats.mtimeMs) {
                    needsRegeneration = true;
                }
            } catch (error) {
                needsRegeneration = true;
            }
            if (needsRegeneration) {
                anyNeedsRegeneration = true;
            }
            specEntries.push({ specFile, targetPath, needsRegeneration });
        }

        if (!anyNeedsRegeneration) {
            debugLogger?.log('generateMirrorCode:skip', { skill: sourceName, reason: 'Source code is up-to-date.' });
            return [];
        }

        debugLogger?.log('generateMirrorCode:start', { skill: sourceName, reason: 'Source is missing or outdated.' });

        const generatedFilePaths = [];

        for (const entry of specEntries) {
            const { specFile, targetPath, needsRegeneration } = entry;
            const outputPath = path.join(sourcePath, targetPath);

            if (!needsRegeneration) {
                continue;
            }

            const specContent = await fs.readFile(specFile.absolutePath, 'utf-8');
            const testingSection = extractTestingSection(specContent);
            const specForPrompt = `\n\n---\n# Spec for: ${targetPath}\n\n${specContent}`;

            let backupSpecForPrompt = '';
            if (backupSpecsExists) {
                const backupSpecPath = path.join(backupSpecsDir, specFile.relativePath);
                const backupSpecExists = await fs.stat(backupSpecPath).then(stat => stat.isFile()).catch(() => false);
                if (backupSpecExists) {
                    const backupContent = await fs.readFile(backupSpecPath, 'utf-8');
                    backupSpecForPrompt = `\n\n---\n# Previous spec for: ${targetPath}\n\n${backupContent}`;
                }
            }

            let existingCodeForFile = '';
            const existingFileExists = await fs.stat(outputPath).then(stat => stat.isFile()).catch(() => false);
            if (existingFileExists) {
                const existingFileContent = await fs.readFile(outputPath, 'utf-8');
                existingCodeForFile = `\n\n---\n# Existing code: ${targetPath}\n\n${existingFileContent}`;
            }

            const prompt = `
# Single-File Code Generation Request

You are an expert JavaScript programmer. Generate the full source code for a single ECMAScript module (ESM) based on the provided specification.

## Module Specification
${specForPrompt}

## Previous Specification (from specs/.backup)
${backupSpecForPrompt || 'No previous spec was available.'}

## Existing Code Context
${existingCodeForFile || 'No existing code was available for this file.'}

## INSTRUCTIONS
- Use the exact relative file path implied by the spec (no extra prefixes like the source directory name).
- Compare current spec with previous spec when available, and focus changes on the parts that differ.
- Preserve existing behavior and structure where the spec is unchanged and the current code already works.
- If the spec contains hardcoded values or exact literals, use them verbatim without modification.
- Do not generate JSDoc-style comment blocks (e.g. /** ... */ with @param/@throws tags) unless explicitly required by the spec.
- Your response **MUST** be a single markdown block for the file.
- You **MUST** use a header to specify the relative file path.
- Do not add any other text, explanations, or apologies.

### Example Response Format:

## file-path: path/to/file.mjs

\`\`\`javascript
// code for path/to/file.mjs goes here...
export const myVar = '...';
\`\`\`

Provide the code for the file derived from the specification.
`;

            const response = await llmAgent.executePrompt(prompt, {
                mode: 'deep',
                responseShape: 'text',
                context: { intent: 'generate-single-file-code-from-spec' },
            });

            const parsedFiles = parseMultiFileMarkdown(response);
            if (parsedFiles.size === 0) {
                throw new Error(`LLM did not return any parsable files for "${targetPath}". Response was: ${response.substring(0, 500)}...`);
            }

            let generatedCode = null;
            if (parsedFiles.has(targetPath)) {
                generatedCode = parsedFiles.get(targetPath);
            } else if (parsedFiles.size === 1) {
                generatedCode = [...parsedFiles.values()][0];
                logger.warn(`[generateMirrorCode] LLM returned unexpected path for "${targetPath}"; using the only returned file content.`);
            }

            if (!generatedCode) {
                throw new Error(`LLM response did not include a usable file for "${targetPath}".`);
            }

            if (testingSection) {
                const tests = await generateBehaviorTestsFromSection(testingSection, generatedCode, llmAgent);
                debugLogger?.log('generateMirrorCode:testsGenerated', { source: sourceName, path: targetPath, count: tests.length });

                debugLogger?.log('generateMirrorCode:testsRun:start', { source: sourceName, path: targetPath, phase: 'initial' });
                let testResults = await runBehaviorTestsInTemp(targetPath, generatedCode, tests);
                debugLogger?.log('generateMirrorCode:testsRun:complete', {
                    source: sourceName,
                    path: targetPath,
                    phase: 'initial',
                    failures: testResults.results.filter(result => !result.pass).length,
                });
                const failures = testResults.results.filter(result => !result.pass);

                if (failures.length > 0) {
                    debugLogger?.log('generateMirrorCode:repair:start', { source: sourceName, path: targetPath, failures: failures.length });
                    const repairFailures = failures.map(failure => ({
                        promptText: failure.promptText,
                        expectedOutput: failure.expectedOutput,
                        actual: failure.actual,
                    }));
                    generatedCode = await repairGeneratedFile(
                        targetPath,
                        specForPrompt,
                        backupSpecForPrompt,
                        generatedCode,
                        repairFailures,
                        llmAgent,
                        'repair-single-file-from-test-failures'
                    );

                    debugLogger?.log('generateMirrorCode:repair:complete', { source: sourceName, path: targetPath });
                    debugLogger?.log('generateMirrorCode:testsRun:start', { source: sourceName, path: targetPath, phase: 'rerun' });
                    testResults = await runBehaviorTestsInTemp(targetPath, generatedCode, tests);
                    debugLogger?.log('generateMirrorCode:testsRun:complete', {
                        source: sourceName,
                        path: targetPath,
                        phase: 'rerun',
                        failures: testResults.results.filter(result => !result.pass).length,
                    });
                    const retryFailures = testResults.results.filter(result => !result.pass);
                    for (const failure of retryFailures) {
                        logger.warn(
                            `[generateMirrorCode] Test failed after repair for "${targetPath}". ` +
                            `Input: ${JSON.stringify(failure.promptText)} ` +
                            `ExpectedOutput: ${JSON.stringify(failure.expectedOutput)} ` +
                            `Actual: ${JSON.stringify(failure.actual)}`
                        );
                    }
                }
            } else {
                try {
                    const tests = await generateBehaviorTests(specForPrompt, generatedCode, llmAgent);
                    debugLogger?.log('generateMirrorCode:testsGenerated', { source: sourceName, path: targetPath, count: tests.length });

                    debugLogger?.log('generateMirrorCode:review:start', { source: sourceName, path: targetPath });
                    const review = await reviewGeneratedCodeWithTests(targetPath, generatedCode, tests, llmAgent);
                    debugLogger?.log('generateMirrorCode:review:complete', { source: sourceName, path: targetPath, status: review.status });
                    if (review.status === 'fail') {
                        debugLogger?.log('generateMirrorCode:repair:start', { source: sourceName, path: targetPath, failures: review.failures.length });
                        const repaired = await repairGeneratedFile(
                            targetPath,
                            specForPrompt,
                            backupSpecForPrompt,
                            generatedCode,
                            review.failures,
                            llmAgent,
                            'repair-single-file-from-review-failures'
                        );
                        debugLogger?.log('generateMirrorCode:repair:complete', { source: sourceName, path: targetPath });
                        generatedCode = repaired;
                    }
                } catch (reviewError) {
                    // Review/repair is best-effort; use the generated code as-is
                    logger.warn(`[generateMirrorCode] Review step failed for "${targetPath}", using generated code as-is: ${reviewError.message}`);
                }
            }

            // Validate generated code is not truncated before writing
            const openBraces = (generatedCode.match(/\{/g) || []).length;
            const closeBraces = (generatedCode.match(/\}/g) || []).length;
            const openParens = (generatedCode.match(/\(/g) || []).length;
            const closeParens = (generatedCode.match(/\)/g) || []).length;
            const braceImbalance = Math.abs(openBraces - closeBraces);
            const parenImbalance = Math.abs(openParens - closeParens);
            if (braceImbalance > 2 || parenImbalance > 2) {
                logger.warn(
                    `[generateMirrorCode] Generated code for "${targetPath}" appears truncated ` +
                    `(braces: ${openBraces}/${closeBraces}, parens: ${openParens}/${closeParens}), skipping write.`
                );
                continue;
            }

            await fs.mkdir(path.dirname(outputPath), { recursive: true });
            await fs.writeFile(outputPath, generatedCode, 'utf-8');
            debugLogger?.log('generateMirrorCode:wroteFile', { source: sourceName, path: outputPath });
            generatedFilePaths.push(targetPath);
        }

        await backupSpecsDirectory(specsDir);
        debugLogger?.log('generateMirrorCode:backupSpecs', { source: sourceName, path: backupSpecsDir });

        logger.log(`[generateMirrorCode] Successfully generated all ${generatedFilePaths.length} files for "${sourceName}".`);

        return generatedFilePaths;
    } catch (error) {
        logger.error(`[generateMirrorCode] Failed to generate code for "${sourceName}": ${error.message}`);
        debugLogger?.log('generateMirrorCode:error', { source: sourceName, error: error.stack });
        throw error;
    }
}

export {
    generateBehaviorTests,
    validateOrRepairGeneratedCode,
};
