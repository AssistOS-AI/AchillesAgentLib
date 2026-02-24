import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { parseJsonResponse, parseMultiFileMarkdown } from './llm-utils.mjs';

const DEFAULT_TESTING_INSTRUCTIONS_RAW = `
Focus on the core/primary functionality of the code. Only include tests that reflect the most important functions or
behaviors; skip minor helpers, formatting-only cases, and edge cases.
`;

const DEFAULT_TEST_PLAN_INSTRUCTIONS_RAW = `
Analyze the current codebase and propose a clear, minimal set of test plans.
Each plan should describe what functionality to test, how to test it, and what kinds of cases are needed.
Use cross-file plans when the behavior spans multiple modules.
Do not reference specs or requirements outside the code shown.
Return only JSON in the requested format.
`;

const DEFAULT_TEST_PLAN_INSTRUCTIONS = DEFAULT_TEST_PLAN_INSTRUCTIONS_RAW.trim();

function buildBehaviorTestPrompt({
    testingInstructions,
    specsForPrompt,
    generatedCodeForPrompt,
    casesFileName,
    importPath,
}) {
    const runnerTemplateExample = `import fs from 'node:fs/promises';
import path from 'node:path';

const testsRaw = await fs.readFile(path.join(process.cwd(), ${JSON.stringify(casesFileName)}), 'utf-8');
const { tests } = JSON.parse(testsRaw);
const modulePath = ${JSON.stringify(importPath)};
const { action } = await import(modulePath);

if (typeof action !== 'function') {
  throw new Error('Generated module does not export an action function.');
}

const results = [];
for (const test of tests) {
  let actual;
  try {
    actual = await action({ promptText: test.promptText });
  } catch (error) {
    actual = error?.message || String(error);
  }
  const pass = JSON.stringify(actual) === JSON.stringify(test.expectedOutput);
  results.push({
    promptText: test.promptText,
    expectedOutput: test.expectedOutput,
    actual,
    pass,
  });
}

process.stdout.write(JSON.stringify({ results }));`;
    return `
# Behavior Test Generation

You are an expert test designer. Generate positive behavior tests for the module's public API and a matching test runner.
Each test must include:
- name (short string)
- input (any JSON value; can be object, array, string, number, boolean, or null)
- expectedOutput (exact JSON value the action should return; can be object, array, string, number, boolean, or null)

The tests MUST be based on the specifications and MUST be valid inputs that should not throw.
Generate only positive tests (no negative/invalid tests) and do not generate edge cases.
Expected outputs must be computed exactly according to the spec.
The tests are NOT about file names or module structure; only runtime behavior.

You must ALSO generate a Node.js ESM test runner (run-tests.mjs) that imports the generated module and executes the tests.
The runner MUST build a "results" array and MUST end with:
process.stdout.write(JSON.stringify({ results }));
This requirement is absolute.

Runner must read test cases from ${JSON.stringify(casesFileName)} and import the module from ${JSON.stringify(importPath)}.
Runner should adapt to the generated module's public API (not necessarily an action export).
Runner should read the tests array and call the appropriate exported function(s) using test.input.
Each result entry MUST include: name, input, expectedOutput, actual, pass.

Network dependency policy (critical):
- Do NOT mock Node.js core modules.
- Do NOT mock modules/libraries that appear installed in the environment.
- Do NOT use any external testing libraries; use only Node.js native APIs.
- The runner MUST delete any temporary files or folders it creates during testing.
- Do NOT try to modify/manipulate the source code in any way. Just import what can be tested and use it.

Example runner template (adapt as needed to match the module's API):


${runnerTemplateExample}

## Testing Instructions
${testingInstructions}

## Specifications
${specsForPrompt}

## Generated Code Context
${generatedCodeForPrompt || 'No generated code context provided.'}

## Output Requirements
Return STRICT JSON with the following shape and no extra keys:
{
  "tests": [
    {
      "name": "...",
      "input": null,
      "expectedOutput": null
    }
  ],
  "runnerCode": "..."
}
Keep the test list small (4-8 tests).
`;
}

function buildSourceFilesListing(sourceFiles) {
    if (!sourceFiles || sourceFiles.size === 0) {
        return 'No source files were provided.';
    }
    const sections = [];
    for (const [filePath, content] of sourceFiles.entries()) {
        sections.push(`${filePath}:\n${content}`);
    }
    return sections.join('\n\n');
}

function buildTestPlanPrompt({
    testingInstructions,
    sourceFiles,
}) {
    return `
# Test Plan Generation

You are an expert test strategist. Read the current codebase and propose a structured test plan.
Your plan must describe which behaviors to test, how to test them, and what test case types are needed.

## Output Format (STRICT JSON ONLY)
{
  "testPlans": [
    {
      "description": "Detailed natural language description of the tests and case types.",
      "sourceFiles": ["relative/path/to/file.mjs", "..."]
    }
  ]
}

## testing
${testingInstructions}

## Source Files
${buildSourceFilesListing(sourceFiles)}

Return ONLY a single JSON object. Do not include markdown fences, commentary, or any extra text.
If you cannot produce a plan, still return {"testPlans": []}.
`;
}

function buildTestFilePrompt({
    description,
    sourceFiles,
}) {
    return `
# Test File Generation

You are an expert JavaScript test author. Generate one executable test file based on the described plan.
The test file must be runnable with Node.js (ESM) and must write JSON results to stdout.

## Plan Description
${description}

## Source Files
${buildSourceFilesListing(sourceFiles)}

## Output Format (STRICT JSON ONLY)
{
  "fileName": "path/to/test-file.mjs",
  "content": "full test file content",
  "testCases": { "any": "json" }
}

Rules:
- Return ONLY a single JSON object, no markdown fences or extra text.
- The test file will be written under the tests/ directory using the provided fileName.
- The test file MUST produce a results array and MUST write it to stdout exactly as JSON:
  process.stdout.write(JSON.stringify({ results }));
- Each results entry MUST include:
  - expected: any JSON value
  - actual: any JSON value
  - pass: boolean
- Do not include an "error" field in results entries. Use pass=false with expected/actual for mismatches.
- Do not write any other stdout output.
- If you return a non-empty testCases JSON object, it will be written under tests/ at "<fileName>.cases.json".
- The test file must read from that cases file path when applicable (relative to the tests/ directory).
- If no testCases are needed, return an empty object {}.
- If you cannot produce tests, still return a JSON object with "fileName", "content", and an empty "testCases" object.
`;
}

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
 * Ask LLM to generate behavioral tests and a matching runner for the module API.
 * @param {string} specsForPrompt
 * @param {string} generatedCodeForPrompt
 * @param {object} llmAgent
 * @param {object} [options]
 * @param {string} [options.testingInstructions]
 * @param {string} [options.intent='generate-behavior-tests']
 * @param {string} [options.errorLabel='Behavior test generation']
 * @returns {Promise<{tests: Array<{name: string, input: any, expectedOutput: any}>, runnerCode: string}>}
 */
export async function generateBehaviorTests(specsForPrompt, generatedCodeForPrompt, llmAgent, options = {}) {
    const {
        testingInstructions = 'Use the full specification to derive valid positive tests.',
        intent = 'generate-behavior-tests',
        errorLabel = 'Behavior test generation',
        casesFileName = 'test-cases.json',
        importPath,
    } = options || {};

    const prompt = buildBehaviorTestPrompt({
        testingInstructions,
        specsForPrompt,
        generatedCodeForPrompt,
        casesFileName,
        importPath,
    });

    const response = await llmAgent.executePrompt(prompt, {
        mode: 'deep',
        responseShape: 'json',
        context: { intent },
    });

    const parsed = parseJsonResponse(response, errorLabel);
    if (!parsed || !Array.isArray(parsed.tests) || parsed.tests.length === 0) {
        throw new Error(`${errorLabel} returned no tests.`);
    }
    if (!parsed.runnerCode || typeof parsed.runnerCode !== 'string') {
        throw new Error(`${errorLabel} returned no runnerCode.`);
    }
    return { tests: parsed.tests, runnerCode: parsed.runnerCode };
}

export const DEFAULT_TESTING_INSTRUCTIONS = DEFAULT_TESTING_INSTRUCTIONS_RAW.trim();

/**
 * Validate generated code against behavior tests, optionally returning corrected code.
 * @param {Map<string, string>} generatedFiles
 * @param {Array<{name: string, promptText: string, expectedOutput: any}>} tests
 * @param {object} llmAgent
 * @returns {Promise<{status: 'pass'} | {status: 'fail', files: Array<{path: string, code: string}>}>}
 */

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
    const prompt = `
# Single-File Code Repair

You are an expert JavaScript programmer. Repair the file so it satisfies the spec and passes the failed test cases.
Return only one markdown block for the file.

## Module Specification
${specForPrompt}

## Previous Specification (from specs/.backup)
${backupSpecForPrompt || 'No previous spec was available.'}

## Generated Code Context
${generatedCodeForFile || 'No generated code was available for this file.'}

## Test Cases
${tests && tests.length > 0 ? JSON.stringify({ tests }, null, 2) : 'No tests were provided.'}

## Test Runner
${runnerCode || 'No test runner was provided.'}

## Failed Cases
${JSON.stringify({ failures }, null, 2)}

## INSTRUCTIONS
- Use the exact relative file path implied by the spec (no extra prefixes like the source directory name).
- Compare current spec with previous spec when available, and focus changes on the parts that differ.
- Preserve existing behavior and structure where the spec is unchanged and the current code already works.
- Specifications are authoritative. If the runner conflicts with the specifications, follow the specifications.
- When possible, keep the implementation compatible with the provided runner and test inputs.
- If the spec contains hardcoded values or exact literals, use them verbatim without modification.
- Do not generate JSDoc-style comment blocks (e.g. /** ... */ with @param/@throws tags) unless explicitly required by the spec.
- Your response **MUST** be a single markdown block for the file.
- You **MUST** use a header to specify the relative file path.
- Do not add any other text, explanations, or apologies.

### Example Response Format:

## file-path: ${targetPath}

\`\`\`javascript
// code for ${targetPath} goes here...
export const myVar = '...';
\`\`\`
`;

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

/**
 * Run behavior tests in the skill's tests/ directory using Node.
 * Writes test-cases.json and run-tests.mjs in tests/.
 * @param {string} skillDir
 * @param {string} targetPath
 * @param {Array<{name: string, input: any, expectedOutput: any}>} tests
 * @param {string} runnerCode
 * @param {object} [options]
 * @param {string} [options.casesFileName='test-cases.json']
 * @param {string} [options.runnerFileName='run-tests.mjs']
 * @returns {Promise<{results: Array<{name?: string, input?: any, expectedOutput: any, actual: any, pass: boolean}>, skipped?: boolean}>}
 */
export async function runBehaviorTestsOnDisk(
    skillDir,
    targetPath,
    tests,
    runnerCode,
    { casesFileName = 'test-cases.json', runnerFileName = 'run-tests.mjs', logger = console } = {}
) {
    const execFileAsync = promisify(execFile);
    const testsDir = path.join(skillDir, 'tests');
    const testsPath = path.join(testsDir, casesFileName);
    const runnerPath = path.join(testsDir, runnerFileName);

    await fs.mkdir(testsDir, { recursive: true });
    await fs.rm(path.join(testsDir, '.mirror'), { recursive: true, force: true }).catch(() => {});
    await fs.writeFile(testsPath, JSON.stringify({ tests }, null, 2), 'utf-8');

    await fs.writeFile(runnerPath, runnerCode, 'utf-8');

    try {
        await execFileAsync('node', ['--check', runnerPath], { cwd: testsDir, maxBuffer: 10 * 1024 * 1024 });
        await execFileAsync(
            'node',
            ['-e', "JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'))", testsPath],
            { cwd: testsDir, maxBuffer: 10 * 1024 * 1024 }
        );
    } catch (error) {
        const stderr = error?.stderr ? String(error.stderr) : '';
        const stdout = error?.stdout ? String(error.stdout) : '';
        const message = error?.message ? String(error.message) : '';
        const details = [message, stderr, stdout].filter(Boolean).join('\n');
        logger.warn(`[generateMirrorCode] Test runner or cases validation failed for "${targetPath}". Skipping tests.\n${details}`);
        return { failedTests: [], skipped: true };
    }

    const { stdout } = await execFileAsync('node', [runnerPath], { cwd: testsDir, maxBuffer: 10 * 1024 * 1024 });
    const parsed = JSON.parse(stdout);
    if (!parsed || !Array.isArray(parsed.results)) {
        throw new Error('Test runner returned invalid results.');
    }
    return parsed;
}
