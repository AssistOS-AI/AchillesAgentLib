import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getDebugLogger } from '../../../../utils/DebugLogger.mjs';
import {
    backupSpecsDirectory,
    findSpecFiles,
    specPathToTarget,
} from './spec-utils.mjs';
import { parseMultiFileMarkdown } from './llm-utils.mjs';
import { buildSingleFileCodePrompt } from './templates/codeGeneration.prompts.mjs';
import { buildRepairPrompt } from './templates/repair.prompts.mjs';
import { action as runTestsAction } from '../../tests-generator/src/index.mjs';
import { action as runFdsAction } from '../../fds-generator/src/index.mjs';
import { getAffectedFilesSection } from '../../fds-generator/src/SpecsManager.mjs';


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

export async function runAllTestsOnDisk(skillDir, logger = console) {
    const execFileAsync = promisify(execFile);
    const testsDir = path.join(skillDir, 'tests');
    const runnerPath = path.join(testsDir, 'runAll.mjs');
    const exists = await fs.stat(runnerPath).then(stat => stat.isFile()).catch(() => false);
    if (!exists) {
        logger.warn(`[generateMirrorCode] runAll.mjs not found in ${testsDir}. Skipping tests.`);
        return { failedTests: [], skipped: true };
    }

    try {
        const { stdout } = await execFileAsync('node', [runnerPath], { cwd: testsDir, maxBuffer: 10 * 1024 * 1024 });
        const parsed = JSON.parse(stdout);
        if (!parsed || !Array.isArray(parsed.failedTests)) {
            throw new Error('runAll.mjs returned invalid results.');
        }
        return parsed;
    } catch (error) {
        const stderr = error?.stderr ? String(error.stderr) : '';
        const stdout = error?.stdout ? String(error.stdout) : '';
        const message = error?.message ? String(error.message) : '';
        const details = [message, stderr, stdout].filter(Boolean).join('\n');
        logger.warn(`[generateMirrorCode] runAll.mjs execution failed.\n${details}`);
        return { failedTests: [], skipped: false, error: details };
    }
}

async function dirExists(dirPath) {
    return fs.stat(dirPath).then(stat => stat.isDirectory()).catch(() => false);
}

async function fileExists(filePath) {
    return fs.stat(filePath).then(stat => stat.isFile()).catch(() => false);
}

function normalizePath(value) {
    return String(value || '').replace(/\\/g, '/').trim();
}

function normalizeRelativePath(value) {
    const normalized = normalizePath(value);
    return normalized.replace(/^\.\//, '');
}

function parseAffectedFiles(sectionText) {
    if (!sectionText || typeof sectionText !== 'string') {
        return [];
    }
    const lines = sectionText.split(/\r?\n/);
    const results = [];

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const bulletMatch = trimmed.match(/^[-*+]\s*(.+)$/);
        const content = bulletMatch ? bulletMatch[1].trim() : trimmed;

        let pathPart = content;
        if (content.includes(' - ')) {
            pathPart = content.split(' - ')[0].trim();
        } else if (content.includes(':')) {
            pathPart = content.split(':')[0].trim();
        }

        const rel = normalizeRelativePath(pathPart);
        if (!rel || !rel.toLowerCase().endsWith('.md')) continue;
        results.push(rel);
    }

    return [...new Set(results)];
}

async function findDsFiles(searchRoot) {
    const files = [];
    const exists = await dirExists(searchRoot);
    if (!exists) {
        return files;
    }

    const entries = await fs.readdir(searchRoot, { withFileTypes: true });
    for (const entry of entries) {
        if (!entry.isFile()) {
            continue;
        }
        if (/^DS.*\.md$/i.test(entry.name)) {
            files.push(path.join(searchRoot, entry.name));
        }
    }

    return files;
}

async function collectDsFiles(targetDir) {
    const roots = [
        targetDir,
        path.join(targetDir, 'docs'),
        path.join(targetDir, 'docs', 'specs'),
    ];

    const seen = new Set();
    const results = [];

    for (const root of roots) {
        const matches = await findDsFiles(root);
        for (const match of matches) {
            if (seen.has(match)) continue;
            seen.add(match);
            results.push(match);
        }
    }

    return results;
}

async function shouldRunFdsGenerator(targetDir, logger) {
    const dsFiles = await collectDsFiles(targetDir);
    if (!dsFiles.length) {
        return false;
    }

    const specsDir = path.join(targetDir, 'specs');
    const specsExists = await dirExists(specsDir);
    if (!specsExists) {
        return true;
    }

    for (const dsPath of dsFiles) {
        const affectedSection = await getAffectedFilesSection(dsPath);
        const affectedFiles = parseAffectedFiles(affectedSection);
        const dsStats = await fs.stat(dsPath);

        if (!affectedFiles.length) {
            logger?.warn?.(`[generateMirrorCode] No affected files listed in ${dsPath}`);
            continue;
        }

        for (const relPath of affectedFiles) {
            const normalizedRel = normalizeRelativePath(relPath);
            const fdsPath = path.join(targetDir, normalizedRel);
            const fdsExists = await fileExists(fdsPath);
            if (!fdsExists) {
                return true;
            }
            const fdsStats = await fs.stat(fdsPath);
            if (dsStats.mtimeMs > fdsStats.mtimeMs) {
                return true;
            }
        }
    }

    return false;
}

/**
 * Ask LLM to repair a single file based on failures.
 * @param {string} targetPath
 * @param {string} specForPrompt
 * @param {string} backupSpecForPrompt
 * @param {string} generatedCodeForFile
 * @param {Array<{input?: any, expectedOutput: any, actual?: any, reason?: string, name?: string}>} failures
 * @param {object} llmAgent
 * @param {string} intent
 * @param {object} [options]
 * @param {string} [options.runnerCode]
 * @param {Array<{name?: string, input?: any, expectedOutput: any}>} [options.tests]
 * @returns {Promise<string>}
 */
export async function repairGeneratedFile(
    targetPath,
    specForPrompt,
    backupSpecForPrompt,
    generatedCodeForFile,
    failures,
    llmAgent,
    intent,
    { runnerCode, tests } = {}
) {
    const prompt = buildRepairPrompt({
        targetPath,
        specForPrompt,
        backupSpecForPrompt,
        generatedCodeForFile,
        failures,
        tests,
        runnerCode,
    });

    const response = await llmAgent.executePrompt(prompt, {
        mode: 'code',
        responseShape: 'text',
        context: { intent },
    });

    const parsedFiles = parseMultiFileMarkdown(response);
    if (parsedFiles.size === 0) {
        throw new Error(`LLM did not return any parsable files while repairing "${targetPath}".`);
    }

    if (parsedFiles.has(targetPath)) {
        return parsedFiles.get(targetPath);
    }

    if (parsedFiles.size === 1) {
        return [...parsedFiles.values()][0];
    }

    throw new Error(`LLM repair response did not include a usable file for "${targetPath}".`);
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
        const shouldRunFds = await shouldRunFdsGenerator(sourcePath, logger);
        if (shouldRunFds) {
            await runFdsAction({
                prompt: sourcePath,
                llmAgent,
                logger,
            });
        }

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
        const testsDir = path.join(sourcePath, 'tests');
        const testsDirExists = await fs.stat(testsDir).then(stat => stat.isDirectory()).catch(() => false);
        const specEntries = [];
        let anyNeedsRegeneration = false;

        for (const specFile of specFiles) {
            const targetPath = specPathToTarget(specFile.relativePath);
            let needsRegeneration = false;
            let needsTestGeneration = false;
            try {
                const specStats = await fs.stat(specFile.absolutePath);
                const outputStats = await fs.stat(path.join(sourcePath, targetPath));
                if (specStats.mtimeMs > outputStats.mtimeMs) {
                    needsRegeneration = true;
                }
                if (!testsDirExists) {
                    needsTestGeneration = true;
                }
            } catch (error) {
                needsRegeneration = true;
            }
            if (needsRegeneration) {
                anyNeedsRegeneration = true;
            }
            specEntries.push({ specFile, targetPath, needsRegeneration, needsTestGeneration });
        }

        const hasTestOnlyWork = !anyNeedsRegeneration && specEntries.some(e => e.needsTestGeneration);

        if (!anyNeedsRegeneration && !specEntries.some(e => e.needsTestGeneration)) {
            debugLogger?.log('generateMirrorCode:skip', { skill: sourceName, reason: 'Source code is up-to-date and tests exist.' });
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

            const prompt = buildSingleFileCodePrompt({
                targetPath,
                specForPrompt,
                backupSpecForPrompt,
                existingCodeForFile,
            });

            const response = await llmAgent.executePrompt(prompt, {
                mode: 'code',
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

        // Pass 2: generate test plans + tests for current codebase
        const shouldGenerateTests = specEntries.some(entry => (entry.needsRegeneration || entry.needsTestGeneration) && !entry.skipTests);
        if (shouldGenerateTests) {
            const codeFiles = new Map();
            for (const entry of specEntries) {
                if (entry.skipTests) {
                    continue;
                }
                const outputPath = path.join(sourcePath, entry.targetPath);
                const exists = await fs.stat(outputPath).then(stat => stat.isFile()).catch(() => false);
                if (!exists) {
                    logger.warn(`[generateMirrorCode] Could not read code for test planning: ${entry.targetPath}`);
                    continue;
                }
                const content = await fs.readFile(outputPath, 'utf-8');
                const normalizedPath = entry.targetPath.replace(/\\/g, '/');
                codeFiles.set(normalizedPath, content);
            }

            const allowRepair = specEntries.some(entry => entry.needsRegeneration && !entry.skipTests);
            const actionResult = await runTestsAction({
                prompt: sourcePath,
                llmAgent,
                sourceFiles: codeFiles,
                logger,
            });
            const generationResults = actionResult?.testResults || actionResult;
            const testFileSources = generationResults?.testFileSources || new Map();
            let testResults = null;

            if (generationResults?.skipped) {
                testResults = { failedTests: [], skipped: true, testFileSources };
                debugLogger?.log('generateMirrorCode:testsRun:skipped', { source: sourceName });
            } else {
                const runResults = await runAllTestsOnDisk(sourcePath, logger);
                testResults = { ...runResults, testFileSources };
            }

            if (testResults?.failedTests) {
                const failures = testResults.failedTests.filter(result => !result.pass);
                debugLogger?.log('generateMirrorCode:testsRun:complete', {
                    source: sourceName,
                    failures: failures.length,
                });
                for (const failure of failures) {
                    logger.warn(
                        `[generateMirrorCode] Test failed for "${failure.file}". ` +
                        `${failure.error ? `Error: ${failure.error}` : ''}`
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
                            const outputPath = path.join(sourcePath, targetPath);
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
                                llmAgent,
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
                        const rerunResult = await runAllTestsOnDisk(sourcePath, logger);
                        testResults = { ...rerunResult, testFileSources };
                    }
                }
            }
        }

        if (hasTestOnlyWork) {
            debugLogger?.log('generateMirrorCode:testsOnly', { source: sourceName, reason: 'Generated tests without code regeneration.' });
            logger.log(`[generateMirrorCode] Generated tests for "${sourceName}" without code regeneration.`);
            return [];
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
