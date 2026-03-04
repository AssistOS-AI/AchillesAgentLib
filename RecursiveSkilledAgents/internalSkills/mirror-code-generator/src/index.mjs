import fs from 'node:fs/promises';
import path from 'node:path';
import { action as runTestsAction } from '../../tests-generator/src/index.mjs';
import { findSpecFiles, specPathToTarget } from './spec-utils.mjs';
import { generateMirrorCode, repairGeneratedFile } from './codegen.mjs';
import { runAllTestsOnDisk } from './test-runner.mjs';


/**
 * Orchestrator skill action entry point.
 * @param {Object} context - Execution context provided by OrchestratorSkillsSubsystem.
 * @param {string} context.prompt - The skill directory path to generate code for.
 * @param {Object} context.recursiveAgent - The recursive agent instance (provides llmAgent).
 * @param {Object} context.llmAgent - The LLM agent instance.
 * @returns {Promise<Object>} Result object with message and generatedFiles array.
 */
export async function action(context) {
    const { prompt, recursiveAgent, llmAgent, logger = console } = context;
    const targetDir = prompt?.trim();

    if (!targetDir) {
        throw new Error('mirror-code-generator requires a skill directory path as input.');
    }

    const agent = llmAgent || recursiveAgent?.llmAgent;
    if (!agent) {
        throw new Error('mirror-code-generator requires an LLM agent.');
    }

    const generatedFiles = await generateMirrorCode(targetDir, agent, logger);

    const testsDir = path.join(targetDir, 'tests');
    const testsDirExists = await fs.stat(testsDir).then(stat => stat.isDirectory()).catch(() => false);
    const shouldGenerateTests = generatedFiles.length > 0 || !testsDirExists;

    if (shouldGenerateTests) {
        const specsDir = path.join(targetDir, 'specs');
        const specsDirExists = await fs.stat(specsDir).then(stat => stat.isDirectory()).catch(() => false);
        if (specsDirExists) {
            const specFiles = await findSpecFiles(specsDir);
            const codeFiles = new Map();
            for (const specFile of specFiles) {
                const targetPath = specPathToTarget(specFile.relativePath).replace(/\\/g, '/');
                const outputPath = path.join(targetDir, targetPath);
                const exists = await fs.stat(outputPath).then(stat => stat.isFile()).catch(() => false);
                if (!exists) {
                    logger.warn(`[generateMirrorCode] Could not read code for test planning: ${targetPath}`);
                    continue;
                }
                const content = await fs.readFile(outputPath, 'utf-8');
                codeFiles.set(targetPath, content);
            }

            if (codeFiles.size > 0) {
                const allowRepair = generatedFiles.length > 0;
                const actionResult = await runTestsAction({
                    prompt: targetDir,
                    llmAgent: agent,
                    sourceFiles: codeFiles,
                    logger,
                });
                const generationResults = actionResult?.testResults || actionResult;
                const testFileSources = generationResults?.testFileSources || new Map();
                let testResults = null;

                if (generationResults?.skipped) {
                    testResults = { failedTests: [], skipped: true, testFileSources };
                } else {
                    const runResults = await runAllTestsOnDisk(targetDir, logger);
                    testResults = { ...runResults, testFileSources };
                }

                if (testResults?.failedTests) {
                    const failures = testResults.failedTests.filter(result => !result.pass);
                    for (const failure of failures) {
                        const errorText = failure.error ? `Error: ${failure.error}` : '';
                        const failedTestsText = Array.isArray(failure.failedTests) && failure.failedTests.length > 0
                            ? `Failed tests: ${JSON.stringify(failure.failedTests)}`
                            : '';
                        const details = [errorText, failedTestsText].filter(Boolean).join(' ');
                        logger.warn(
                            `[generateMirrorCode] Test failed for "${failure.file}". ` +
                            details
                        );
                    }

                    if (allowRepair && failures.length > 0 && testFileSources) {
                        let repairedAny = false;
                        for (const failedEntry of failures) {
                            const mapping = testFileSources.get?.(failedEntry.file);
                            if (!mapping || !Array.isArray(mapping.sourceFiles) || mapping.sourceFiles.length === 0) {
                                logger.warn(`[generateMirrorCode] No source files mapped for failed test file: ${failedEntry.file}`);
                                continue;
                            }

                            const failureDetails = Array.isArray(failedEntry.failedTests)
                                ? failedEntry.failedTests.map(test => ({
                                    expectedOutput: test.expected,
                                    actual: test.actual,
                                    testFile: test.fileName || failedEntry.file,
                                    reason: `Test failure in ${test.fileName || failedEntry.file}`,
                                }))
                                : [];

                            for (const sourceFile of mapping.sourceFiles) {
                                const targetPath = sourceFile.replace(/\\/g, '/');
                                const outputPath = path.join(targetDir, targetPath);
                                const exists = await fs.stat(outputPath).then(stat => stat.isFile()).catch(() => false);
                                if (!exists) {
                                    logger.warn(`[generateMirrorCode] Missing source file for repair: ${sourceFile}`);
                                    continue;
                                }
                                const existingCode = await fs.readFile(outputPath, 'utf-8');

                                const specForPrompt = `\n\n---\n# Spec for: ${targetPath}\n\nNo spec available. If this file is not responsible for the failures, return the code unchanged.`;
                                const repairedCode = await repairGeneratedFile(
                                    targetPath,
                                    specForPrompt,
                                    '',
                                    existingCode,
                                    failureDetails,
                                    agent,
                                    'repair-single-file-from-test-failures',
                                    { tests: failureDetails }
                                );

                                if (repairedCode && repairedCode !== existingCode) {
                                    await fs.writeFile(outputPath, repairedCode, 'utf-8');
                                    repairedAny = true;
                                }
                            }
                        }

                        if (repairedAny) {
                            await runAllTestsOnDisk(targetDir, logger);
                        }
                    }
                }
            }
        }
    }

    return {
        message: `Code generation completed for ${targetDir}`,
        generatedFiles: generatedFiles || [],
    };
}
export { generateMirrorCode, repairGeneratedFile, runAllTestsOnDisk };
