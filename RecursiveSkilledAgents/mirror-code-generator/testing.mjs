import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseJsonResponse, parseMultiFileMarkdown } from './llm-utils.mjs';

const DEFAULT_TESTING_INSTRUCTIONS_RAW = `
Focus on the core/primary functionality of the code. Only include tests that reflect the most important functions or
behaviors; skip minor helpers, formatting-only cases, and edge cases.
`;

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

External dependency policy (critical):
- The runner MUST mock external dependencies used by the generated module.
- External dependencies are any imports outside the generated code (e.g. npm packages, SDKs, third-party APIs).
- Node.js native libraries are exempt from mocking.
- The runner MUST NOT perform real network calls or talk to real external services.

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
        return { results: [], skipped: true };
    }

    const { stdout } = await execFileAsync('node', [runnerPath], { cwd: testsDir, maxBuffer: 10 * 1024 * 1024 });
    const parsed = JSON.parse(stdout);
    if (!parsed || !Array.isArray(parsed.results)) {
        throw new Error('Test runner returned invalid results.');
    }
    return parsed;
}
