import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { parseJsonResponse, parseMultiFileMarkdown } from './llm-utils.mjs';
import { buildRepairPrompt } from './templates/repair.prompts.mjs';
import { buildTestFilePrompt, buildTestPlanPrompt } from './templates/testing.prompts.mjs';

const DEFAULT_TEST_PLAN_INSTRUCTIONS_RAW = `
Analyze the current codebase and propose a clear, minimal set of test plans.
Each plan should describe what functionality to test, how to test it, and what kinds of cases are needed.
Use cross-file plans when the behavior spans multiple modules.
Do not reference specs or requirements outside the code shown.
Return only JSON in the requested format.
`;

const DEFAULT_TEST_PLAN_INSTRUCTIONS = DEFAULT_TEST_PLAN_INSTRUCTIONS_RAW.trim();

function isEmptyTestCases(value) {
    if (!value) {
        return true;
    }
    if (Array.isArray(value)) {
        return value.length === 0;
    }
    if (typeof value === 'object') {
        return Object.keys(value).length === 0;
    }
    return false;
}

function normalizeRepoPath(rawPath) {
    if (typeof rawPath !== 'string') {
        return '';
    }
    const normalized = rawPath.replace(/\\/g, '/').trim();
    const stripped = normalized.replace(/^\/+/, '');
    const safeParts = stripped.split('/').filter(part => part && part !== '.' && part !== '..');
    return safeParts.join('/');
}

export async function generateTestPlans(sourceFiles, llmAgent, options = {}) {
    const {
        testingInstructions = DEFAULT_TEST_PLAN_INSTRUCTIONS,
        intent = 'generate-test-plans',
        errorLabel = 'Test plan generation',
    } = options || {};

    const prompt = buildTestPlanPrompt({
        testingInstructions,
        sourceFiles,
    });

    const response = await llmAgent.executePrompt(prompt, {
        mode: 'deep',
        responseShape: 'json',
        context: { intent },
    });

    const parsed = parseJsonResponse(response, errorLabel);
    if (!parsed || !Array.isArray(parsed.testPlans) || parsed.testPlans.length === 0) {
        throw new Error(`${errorLabel} returned no test plans.`);
    }

    return parsed.testPlans.filter((plan) => plan
        && typeof plan.description === 'string'
        && Array.isArray(plan.sourceFiles)
        && plan.sourceFiles.length > 0);
}

export async function generateTestFileForPlan(plan, sourceFiles, llmAgent, options = {}) {
    const {
        intent = 'generate-test-file',
        errorLabel = 'Test file generation',
    } = options || {};

    const prompt = buildTestFilePrompt({
        description: plan.description,
        sourceFiles,
    });

    const response = await llmAgent.executePrompt(prompt, {
        mode: 'deep',
        responseShape: 'json',
        context: { intent },
    });

    const parsed = parseJsonResponse(response, errorLabel);
    if (!parsed || typeof parsed.fileName !== 'string' || typeof parsed.content !== 'string') {
        throw new Error(`${errorLabel} returned invalid fileName/content.`);
    }

    return {
        fileName: parsed.fileName.trim(),
        content: parsed.content,
        testCases: parsed.testCases,
        fixtures: parsed.fixtures,
    };
}

export async function ensureRunAllTemplate(skillDir, logger = console) {
    const templatePath = path.join(
        path.dirname(fileURLToPath(import.meta.url)),
        'templates',
        'runAll.mjs'
    );
    const testsDir = path.join(skillDir, 'tests');
    const targetPath = path.join(testsDir, 'runAll.mjs');
    const exists = await fs.stat(targetPath).then(stat => stat.isFile()).catch(() => false);
    if (exists) {
        return targetPath;
    }
    await fs.mkdir(testsDir, { recursive: true });
    await fs.copyFile(templatePath, targetPath);
    logger.log(`[generateMirrorCode] Wrote test runner template to ${targetPath}`);
    return targetPath;
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

export async function generatePlannedTestsOnDisk(
    skillDir,
    sourceFiles,
    llmAgent,
    { logger = console, testingInstructions = DEFAULT_TEST_PLAN_INSTRUCTIONS, allowRepair = false } = {}
) {
    const execFileAsync = promisify(execFile);
    if (!sourceFiles || sourceFiles.size === 0) {
        logger.warn('[generateMirrorCode] No source files available for test planning. Skipping tests.');
        return { failedTests: [], skipped: true };
    }

    const plans = await generateTestPlans(sourceFiles, llmAgent, {
        testingInstructions,
        intent: 'generate-test-plans',
        errorLabel: 'Test plan generation',
    });

    const testsDir = path.join(skillDir, 'tests');
    await fs.mkdir(testsDir, { recursive: true });

    const testFileSources = new Map();

    for (const plan of plans) {
        const planFiles = new Map();
        for (const filePath of plan.sourceFiles) {
            if (sourceFiles.has(filePath)) {
                planFiles.set(filePath, sourceFiles.get(filePath));
            }
        }
        if (planFiles.size === 0) {
            logger.warn('[generateMirrorCode] Test plan referenced missing source files. Skipping plan.');
            continue;
        }

        const testFile = await generateTestFileForPlan(plan, planFiles, llmAgent, {
            intent: 'generate-test-file',
            errorLabel: 'Test file generation',
        });

        const normalizedFileName = testFile.fileName
            .replace(/^\/+/, '')
            .replace(/^tests\//, '');
        const testFilePath = path.join(skillDir, 'tests', normalizedFileName);
        await fs.mkdir(path.dirname(testFilePath), { recursive: true });
        await fs.writeFile(testFilePath, testFile.content, 'utf-8');

        const hasTestCases = !isEmptyTestCases(testFile.testCases);
        if (hasTestCases) {
            const casesPath = `${testFilePath}.cases.json`;
            await fs.writeFile(casesPath, JSON.stringify(testFile.testCases, null, 2), 'utf-8');
        }

        if (Array.isArray(testFile.fixtures) && testFile.fixtures.length > 0) {
            for (const fixture of testFile.fixtures) {
                const fixturePath = normalizeRepoPath(fixture?.path);
                if (!fixturePath) {
                    continue;
                }
                const targetPath = path.join(skillDir, fixturePath);
                await fs.mkdir(path.dirname(targetPath), { recursive: true });
                const encoding = fixture?.encoding === 'base64' ? 'base64' : 'utf-8';
                const content = typeof fixture?.content === 'string' ? fixture.content : '';
                const data = encoding === 'base64' ? Buffer.from(content, 'base64') : content;
                await fs.writeFile(targetPath, data);
            }
        }

        testFileSources.set(normalizedFileName, {
            sourceFiles: [...planFiles.keys()],
            description: plan.description,
        });

        try {
            await execFileAsync('node', ['--check', testFilePath], { cwd: skillDir, maxBuffer: 10 * 1024 * 1024 });
        } catch (error) {
            logger.warn(`[generateMirrorCode] test file tests/${normalizedFileName} has syntax errors.`);
        }
    }

    await ensureRunAllTemplate(skillDir, logger);
    const initialResults = await runAllTestsOnDisk(skillDir, logger);

    if (!allowRepair || initialResults?.skipped) {
        return initialResults;
    }

    const failedTestFiles = (initialResults.failedTests || []).filter(entry => entry && entry.pass === false);
    if (failedTestFiles.length === 0) {
        return initialResults;
    }

    let repairedAny = false;
    for (const failedEntry of failedTestFiles) {
        const mapping = testFileSources.get(failedEntry.file);
        if (!mapping || !Array.isArray(mapping.sourceFiles) || mapping.sourceFiles.length === 0) {
            logger.warn(`[generateMirrorCode] No source files mapped for failed test file: ${failedEntry.file}`);
            continue;
        }

        const failures = Array.isArray(failedEntry.failedTests)
            ? failedEntry.failedTests.map(test => ({
                expectedOutput: test.expected,
                actual: test.actual,
                testFile: test.fileName || failedEntry.file,
                reason: `Test failure in ${test.fileName || failedEntry.file}`,
            }))
            : [];

        for (const sourceFile of mapping.sourceFiles) {
            if (!sourceFiles.has(sourceFile)) {
                logger.warn(`[generateMirrorCode] Missing source file for repair: ${sourceFile}`);
                continue;
            }
            const targetPath = sourceFile.replace(/\\/g, '/');
            const outputPath = path.join(skillDir, targetPath);
            const existingCode = await fs.readFile(outputPath, 'utf-8');

            const specForPrompt = `\n\n---\n# Spec for: ${targetPath}\n\nNo spec available. If this file is not responsible for the failures, return the code unchanged.`;
            const repairedCode = await repairGeneratedFile(
                targetPath,
                specForPrompt,
                '',
                existingCode,
                failures,
                llmAgent,
                'repair-single-file-from-test-failures',
                { tests: failures }
            );

            if (repairedCode && repairedCode !== existingCode) {
                await fs.writeFile(outputPath, repairedCode, 'utf-8');
                repairedAny = true;
            }
        }
    }

    if (!repairedAny) {
        return initialResults;
    }

    return runAllTestsOnDisk(skillDir, logger);
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
        mode: 'deep',
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
