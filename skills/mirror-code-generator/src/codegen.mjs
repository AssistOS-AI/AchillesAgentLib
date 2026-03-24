import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getDebugLogger } from '../../../utils/DebugLogger.mjs';
import {
    backupSpecsDirectory,
    findSpecFiles,
    specPathToTarget,
} from './spec-utils.mjs';
import { parseMultiFileMarkdown, createCodeResponseValidator } from './llm-utils.mjs';
import { buildSingleFileCodePrompt } from './templates/codeGeneration.prompts.mjs';
import { buildRepairPrompt } from './templates/repair.prompts.mjs';
import { enrichFdsDependencies } from './fds-deps.mjs';

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
 * @returns {Promise<string>}
 */
async function repairGeneratedFile(
    targetPath,
    specForPrompt,
    backupSpecForPrompt,
    generatedCodeForFile,
    failures,
    llmAgent,
    intent,
    { runnerCode } = {}
) {
    const prompt = buildRepairPrompt({
        targetPath,
        specForPrompt,
        backupSpecForPrompt,
        generatedCodeForFile,
        failures,
        runnerCode,
    });

    const response = await llmAgent.executePrompt(prompt, {
        tier: 'code',
        responseShape: 'text',
        context: { intent },
        responseValidator: createCodeResponseValidator(),
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
 * @returns {Promise<{message: string, generatedFiles: string[]}>} Result describing generation status.
 */
async function generateMirrorCode(sourcePath, llmAgent, logger = console) {
    const debugLogger = getDebugLogger();
    const execFileAsync = promisify(execFile);
    const specsDir = path.join(sourcePath, 'specs');
    const backupSpecsDir = path.join(specsDir, '.backup');
    const sourceName = path.basename(sourcePath);

    try {
        const specsDirExists = await fs.stat(specsDir).then(stat => stat.isDirectory()).catch(() => false);
        if (!specsDirExists) {
            debugLogger?.log('generateMirrorCode:skip', { skill: sourceName, reason: 'No specs directory found.' });
            return {
                message: `Skipped: no specs directory for "${sourceName}".`,
                generatedFiles: [],
            };
        }

        const specFiles = await findSpecFiles(specsDir);
        if (specFiles.length === 0) {
            logger.warn(`[generateMirrorCode] No spec files found in ${specsDir} for "${sourceName}".`);
            return {
                message: `Skipped: no spec files for "${sourceName}".`,
                generatedFiles: [],
            };
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
            return {
                message: `Skipped: source is up-to-date for "${sourceName}".`,
                generatedFiles: [],
            };
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
            const enrichedSpecContent = await enrichFdsDependencies(specContent, sourcePath);
            const specForPrompt = `\n\n---\n# Spec for: ${targetPath}\n\n${enrichedSpecContent}`;

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
                tier: 'code',
                responseShape: 'text',
                context: { intent: 'generate-single-file-code-from-spec' },
                responseValidator: createCodeResponseValidator(),
            });

            const parsedFiles = parseMultiFileMarkdown(response);

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
                        `Reverting to previous version.\n${retryCheck.error}`
                    );
                    if (entry.previousFileContent !== null) {
                        await fs.writeFile(outputPath, entry.previousFileContent, 'utf-8');
                    } else {
                        await fs.rm(outputPath, { force: true });
                    }
                    continue;
                }
            }
        }

        await backupSpecsDirectory(specsDir);
        debugLogger?.log('generateMirrorCode:backupSpecs', { source: sourceName, path: backupSpecsDir });

        logger.log(`[generateMirrorCode] Successfully generated all ${generatedFilePaths.length} files for "${sourceName}".`);

        return {
            message: `Generated ${generatedFilePaths.length} file(s) for "${sourceName}".`,
            generatedFiles: generatedFilePaths,
        };
    } catch (error) {
        logger.error(`[generateMirrorCode] Failed to generate code for "${sourceName}": ${error.message}`);
        debugLogger?.log('generateMirrorCode:error', { source: sourceName, error: error.stack });
        throw error;
    }
}

export { generateMirrorCode };
