import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { buildTestFilePrompt, buildTestPlanPrompt } from './templates/testing.prompts.mjs';
import { parseSections } from '../../fds-generator/src/SpecsManager.mjs';

const execFileAsync = promisify(execFile);

/**
 * Short name identifier for this internal skill.
 */
export const shortName = 'tests-generator';

/**
 * Descriptor metadata for this internal skill.
 */
export const descriptor = {
    title: 'Tests Generator',
    summary: 'Generates and runs tests for a skill directory based on source files.',
    sections: {},
};

/**
 * Orchestrator skill action entry point.
 * @param {Object} context - Execution context provided by OrchestratorSkillsSubsystem.
 * @param {string} context.prompt - The skill directory path to generate tests for.
 * @param {Object} context.recursiveAgent - The recursive agent instance (provides llmAgent).
 * @param {Object} context.llmAgent - The LLM agent instance.
 * @param {Map<string, string>} [context.sourceFiles] - Optional source files map for planning tests.
 * @param {object} [context.logger=console] - Logger instance.
 * @returns {Promise<Object>} Result object with message and testResults.
 */
export async function action(context) {
    const {
        prompt,
        recursiveAgent,
        llmAgent,
        sourceFiles,
        logger = console,
    } = context || {};
    const targetDir = typeof prompt === 'string' ? prompt.trim() : '';

    if (!targetDir) {
        throw new Error('tests-generator requires a skill directory path as input.');
    }

    const agent = llmAgent || recursiveAgent?.llmAgent;
    if (!agent) {
        throw new Error('tests-generator requires an LLM agent.');
    }

    const fileMap = sourceFiles instanceof Map ? sourceFiles : new Map();
    const testResults = await generatePlannedTestsOnDisk(targetDir, fileMap, agent, {
        logger,
    });

    return {
        message: `Test generation completed for ${targetDir}`,
        testResults,
    };
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

function parseJsonResponse(response, label) {
    if (response && typeof response === 'object') {
        return response;
    }
    if (typeof response !== 'string') {
        throw new Error(`${label} response is not JSON or string.`);
    }
    try {
        return JSON.parse(response);
    } catch (error) {
        throw new Error(`${label} response could not be parsed as JSON: ${error.message}`);
    }
}

export async function generateTestPlans(sourceFiles, llmAgent, options = {}) {
    const {
        intent = 'generate-test-plans',
        errorLabel = 'Test plan generation',
        fdsEntries = [],
    } = options || {};

    const prompt = buildTestPlanPrompt({ fdsEntries });

    const response = await llmAgent.executePrompt(prompt, {
        mode: 'code',
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
        mode: 'code',
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
    logger.log(`[tests-generator] Wrote test runner template to ${targetPath}`);
    return targetPath;
}

export async function generatePlannedTestsOnDisk(
    skillDir,
    sourceFiles,
    llmAgent,
    { logger = console } = {}
) {
    const fdsEntries = await collectFdsPlanEntries(skillDir, logger);
    const plans = await generateTestPlans(sourceFiles, llmAgent, {
        intent: 'generate-test-plans',
        errorLabel: 'Test plan generation',
        fdsEntries,
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
            logger.warn('[tests-generator] Test plan referenced missing source files. Skipping plan.');
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
            logger.warn(`[tests-generator] test file tests/${normalizedFileName} has syntax errors.`);
        }
    }

    await ensureRunAllTemplate(skillDir, logger);
    return { skipped: false, testFileSources };
}

async function collectFdsPlanEntries(skillDir, logger) {
    const specsDir = path.join(skillDir, 'specs');
    const specsExists = await fs.stat(specsDir).then(stat => stat.isDirectory()).catch(() => false);
    if (!specsExists) {
        logger?.warn?.('[tests-generator] No specs directory available for test planning.');
        return [];
    }
    const specFiles = await listSpecFiles(specsDir);
    if (specFiles.length === 0) {
        logger?.warn?.('[tests-generator] No FDS files found in specs/.');
        return [];
    }
    const entries = [];
    for (const specPath of specFiles) {
        try {
            const content = await fs.readFile(specPath, 'utf-8');
            const sections = parseSections(content);
            const relativeSpecPath = path.relative(specsDir, specPath).replace(/\\/g, '/');
            entries.push({
                path: `src/${relativeSpecPath.replace(/\.mds?$/i, '')}`,
                sections: {
                    Dependencies: sections.get('Dependencies') || '',
                    'Main Functions': sections.get('Main Functions') || '',
                    Exports: sections.get('Exports') || '',
                    Testing: sections.get('Testing') || '',
                },
            });
        } catch (error) {
            logger?.warn?.(`[tests-generator] Failed to read FDS at ${specPath}: ${error.message}`);
        }
    }
    return entries;
}

async function listSpecFiles(dirPath) {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const results = [];
    for (const entry of entries) {
        if (entry.isDirectory()) {
            if (entry.name === '.backup') {
                continue;
            }
            const nested = await listSpecFiles(path.join(dirPath, entry.name));
            results.push(...nested);
            continue;
        }
        if (entry.isFile() && /\.mds?$/i.test(entry.name)) {
            results.push(path.join(dirPath, entry.name));
        }
    }
    return results;
}
