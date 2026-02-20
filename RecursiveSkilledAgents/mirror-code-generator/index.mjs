import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getDebugLogger } from '../../utils/DebugLogger.mjs';
import {
    backupSpecsDirectory,
    extractTestingSection,
    findSpecFiles,
    specPathToTarget,
} from './spec-utils.mjs';
import { parseMultiFileMarkdown } from './llm-utils.mjs';
import {
    DEFAULT_TESTING_INSTRUCTIONS,
    generateBehaviorTests,
    repairGeneratedFile,
    runBehaviorTestsOnDisk,
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
    const execFileAsync = promisify(execFile);
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
        const generatedFiles = new Map();

        // Pass 1: generate all stale files
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
- If the current spec and existing code already implement the same behavior, return the existing code without changes.
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

            entry.generatedCode = generatedCode;
            entry.testingSection = testingSection;
            entry.specForPrompt = specForPrompt;
            entry.backupSpecForPrompt = backupSpecForPrompt;
            generatedFiles.set(targetPath, generatedCode);
        }

        const runNodeSyntaxCheck = async (filePath) => {
            try {
                await execFileAsync('node', ['--check', filePath]);
                return { ok: true };
            } catch (error) {
                const stderr = error?.stderr ? String(error.stderr) : '';
                const stdout = error?.stdout ? String(error.stdout) : '';
                const message = error?.message ? String(error.message) : '';
                const details = [message, stderr, stdout].filter(Boolean).join('\n');
                return { ok: false, error: details || 'Unknown syntax error.' };
            }
        };

        // Pass 1.5: write generated files to disk before testing
        for (const entry of specEntries) {
            const { targetPath, needsRegeneration } = entry;
            if (!needsRegeneration) {
                continue;
            }

            const generatedCode = generatedFiles.get(targetPath);
            if (!generatedCode) {
                continue;
            }

            const outputPath = path.join(sourcePath, targetPath);
            const existingFileExists = await fs.stat(outputPath).then(stat => stat.isFile()).catch(() => false);
            if (existingFileExists) {
                entry.previousFileContent = await fs.readFile(outputPath, 'utf-8');
            } else {
                entry.previousFileContent = null;
            }
            await fs.mkdir(path.dirname(outputPath), { recursive: true });
            await fs.writeFile(outputPath, generatedCode, 'utf-8');
            debugLogger?.log('generateMirrorCode:wroteFile', { source: sourceName, path: outputPath });
            generatedFilePaths.push(targetPath);

            const initialCheck = await runNodeSyntaxCheck(outputPath);
            if (!initialCheck.ok) {
                logger.warn(
                    `[generateMirrorCode] Syntax check failed for "${targetPath}". ` +
                    `Attempting regeneration.\n${initialCheck.error}`
                );
                const specForPrompt = entry.specForPrompt || '';
                const backupSpecForPrompt = entry.backupSpecForPrompt || '';
                const repairFailures = [
                    {
                        reason: 'Node syntax check failed.',
                        error: initialCheck.error,
                    },
                ];
                const repairedCode = await repairGeneratedFile(
                    targetPath,
                    specForPrompt,
                    backupSpecForPrompt,
                    generatedCode,
                    repairFailures,
                    llmAgent,
                    'repair-single-file-from-syntax-error'
                );
                generatedFiles.set(targetPath, repairedCode);
                await fs.writeFile(outputPath, repairedCode, 'utf-8');
                debugLogger?.log('generateMirrorCode:wroteFile', { source: sourceName, path: outputPath });

                const retryCheck = await runNodeSyntaxCheck(outputPath);
                if (!retryCheck.ok) {
                    logger.warn(
                        `[generateMirrorCode] Syntax check failed again for "${targetPath}". ` +
                        `Reverting to previous version and skipping tests.\n${retryCheck.error}`
                    );
                    if (entry.previousFileContent !== null) {
                        await fs.writeFile(outputPath, entry.previousFileContent, 'utf-8');
                    } else {
                        await fs.rm(outputPath, { force: true });
                    }
                    entry.skipTests = true;
                    continue;
                }
            }
        }

        // Pass 2: test + repair for regenerated files
        for (const entry of specEntries) {
            const { targetPath, needsRegeneration } = entry;
            if (!needsRegeneration) {
                continue;
            }

            let generatedCode = generatedFiles.get(targetPath);
            if (!generatedCode) {
                continue;
            }

            if (entry.skipTests) {
                continue;
            }

            const testingSection = entry.testingSection;
            const specForPrompt = entry.specForPrompt;
            const backupSpecForPrompt = entry.backupSpecForPrompt;

            const normalizedTargetPath = targetPath.replace(/\\/g, '/');
            const importPath = `../${normalizedTargetPath}`;
            const { tests, runnerCode } = testingSection
                ? await generateBehaviorTests(specForPrompt, generatedCode, llmAgent, {
                    testingInstructions: testingSection,
                    intent: 'generate-behavior-tests-from-section',
                    errorLabel: 'Behavior test generation (section)',
                    importPath,
                })
                : await generateBehaviorTests(specForPrompt, generatedCode, llmAgent, {
                    testingInstructions: DEFAULT_TESTING_INSTRUCTIONS,
                    intent: 'generate-core-behavior-tests',
                    errorLabel: 'Core behavior test generation',
                    importPath,
                });
            debugLogger?.log('generateMirrorCode:testsGenerated', { source: sourceName, path: targetPath, count: tests.length });

            debugLogger?.log('generateMirrorCode:testsRun:start', { source: sourceName, path: targetPath, phase: 'initial' });
            let testResults = await runBehaviorTestsOnDisk(sourcePath, targetPath, tests, runnerCode, { logger });
            if (testResults?.skipped) {
                debugLogger?.log('generateMirrorCode:testsRun:skipped', { source: sourceName, path: targetPath, phase: 'initial' });
                continue;
            }
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
                    name: failure.name,
                    input: failure.input,
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
                    'repair-single-file-from-test-failures',
                    { runnerCode, tests }
                );

                generatedFiles.set(targetPath, generatedCode);
                const outputPath = path.join(sourcePath, targetPath);
                await fs.mkdir(path.dirname(outputPath), { recursive: true });
                await fs.writeFile(outputPath, generatedCode, 'utf-8');
                debugLogger?.log('generateMirrorCode:wroteFile', { source: sourceName, path: outputPath });

                debugLogger?.log('generateMirrorCode:repair:complete', { source: sourceName, path: targetPath });
                debugLogger?.log('generateMirrorCode:testsRun:start', { source: sourceName, path: targetPath, phase: 'rerun' });
                testResults = await runBehaviorTestsOnDisk(sourcePath, targetPath, tests, runnerCode, { logger });
                if (testResults?.skipped) {
                    debugLogger?.log('generateMirrorCode:testsRun:skipped', { source: sourceName, path: targetPath, phase: 'rerun' });
                    continue;
                }
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
                        `Name: ${JSON.stringify(failure.name)} ` +
                        `Input: ${JSON.stringify(failure.input)} ` +
                        `ExpectedOutput: ${JSON.stringify(failure.expectedOutput)} ` +
                        `Actual: ${JSON.stringify(failure.actual)}`
                    );
                }
            }

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

export { generateBehaviorTests };
