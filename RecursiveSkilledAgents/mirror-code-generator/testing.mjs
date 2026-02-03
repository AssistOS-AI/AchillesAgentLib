import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { buildGeneratedFilesBlock, parseJsonResponse, parseMultiFileMarkdown } from './llm-utils.mjs';

/**
 * Ask LLM to generate behavioral tests for the action(promptText) API.
 * @param {string} specsForPrompt
 * @param {string} generatedCodeForPrompt
 * @param {object} llmAgent
 * @returns {Promise<Array<{name: string, promptText: string, expectedOutput: any}>>}
 */
export async function generateBehaviorTests(specsForPrompt, generatedCodeForPrompt, llmAgent) {
    const prompt = `
# Behavior Test Generation

You are an expert test designer. Generate positive behavior tests for a skill's public API: action({ promptText }).
Each test must include:
- name (short string)
- promptText (string; may be natural language or structured, no restrictions)
- expectedOutput (exact JSON value the action should return; can be object, array, string, number, boolean, or null)

The tests MUST be based on the specifications and MUST be valid inputs that should not throw.
Generate only positive tests (no negative/invalid tests) and do not generate edge cases.
Expected outputs must be computed exactly according to the spec.
The tests are NOT about file names or module structure; only runtime behavior.

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
      "promptText": "...",
      "expectedOutput": null
    }
  ]
}
Keep the test list small (4-8 tests).
`;

    const response = await llmAgent.executePrompt(prompt, {
        mode: 'deep',
        responseShape: 'json',
        context: { intent: 'generate-behavior-tests' },
    });

    const parsed = parseJsonResponse(response, 'Behavior test generation');
    if (!parsed || !Array.isArray(parsed.tests) || parsed.tests.length === 0) {
        throw new Error('Behavior test generation returned no tests.');
    }
    return parsed.tests;
}

/**
 * Ask LLM to generate test cases based on explicit testing instructions.
 * @param {string} testingSection
 * @param {string} generatedCodeForPrompt
 * @param {object} llmAgent
 * @returns {Promise<Array<{promptText: string, expectedOutput: any}>>}
 */
export async function generateBehaviorTestsFromSection(testingSection, generatedCodeForPrompt, llmAgent) {
    const prompt = `
# Test Case Generation

You are an expert test designer. Generate positive test cases for a skill's public API: action({ promptText }).
Each test must include:
- promptText (string)
- expectedOutput (exact JSON value the action should return; can be object, array, string, number, boolean, or null)

The tests MUST be based strictly on the testing/validation instructions below.
Generate only positive tests (no negative/invalid tests) and do not generate edge cases.
Expected outputs must be computed exactly according to the instructions.

## Testing Instructions
${testingSection}

## Generated Code Context
${generatedCodeForPrompt || 'No generated code context provided.'}

## Output Requirements
Return STRICT JSON with the following shape and no extra keys:
{
  "tests": [
    {
      "promptText": "...",
      "expectedOutput": null
    }
  ]
}
Keep the test list small (4-8 tests).
`;

    const response = await llmAgent.executePrompt(prompt, {
        mode: 'deep',
        responseShape: 'json',
        context: { intent: 'generate-behavior-tests-from-section' },
    });

    const parsed = parseJsonResponse(response, 'Behavior test generation (section)');
    if (!parsed || !Array.isArray(parsed.tests) || parsed.tests.length === 0) {
        throw new Error('Behavior test generation (section) returned no tests.');
    }
    return parsed.tests;
}

/**
 * Validate generated code against behavior tests, optionally returning corrected code.
 * @param {Map<string, string>} generatedFiles
 * @param {Array<{name: string, promptText: string, expectedOutput: any}>} tests
 * @param {object} llmAgent
 * @returns {Promise<{status: 'pass'} | {status: 'fail', files: Array<{path: string, code: string}>}>}
 */
export async function validateOrRepairGeneratedCode(generatedFiles, tests, llmAgent) {
    const filesBlock = buildGeneratedFilesBlock(generatedFiles);
    const prompt = `
# Behavior Validation / Repair

You are a senior engineer. Given the code and the behavior tests, decide if the code is correct.
If you consider the test input would result in the expected output, you may treat it as pass.
If the code produces nondeterministic results, you may accept minor differences between expectedOutput and the likely actual output.

If all tests pass, return:
{ "status": "pass" }

If any test would fail, return:
{
  "status": "fail",
  "files": [
    { "path": "relative/path.ext", "code": "..." }
  ]
}

Do NOT include explanations. Only strict JSON.

## Behavior Tests
${JSON.stringify({ tests }, null, 2)}

## Generated Code
${filesBlock}
`;

    const response = await llmAgent.executePrompt(prompt, {
        mode: 'deep',
        responseShape: 'json',
        context: { intent: 'validate-or-repair-generated-code' },
    });

    const parsed = parseJsonResponse(response, 'Behavior validation');
    if (!parsed || (parsed.status !== 'pass' && parsed.status !== 'fail')) {
        throw new Error('Behavior validation returned invalid status.');
    }
    if (parsed.status === 'fail') {
        if (!Array.isArray(parsed.files) || parsed.files.length === 0) {
            throw new Error('Behavior validation returned fail without files.');
        }
    }
    return parsed;
}

/**
 * Ask LLM to review if code passes tests and list failures.
 * @param {string} filePath
 * @param {string} code
 * @param {Array<{promptText: string, expectedOutput: any}>} tests
 * @param {object} llmAgent
 * @returns {Promise<{status: 'pass'} | {status: 'fail', failures: Array<{promptText: string, expectedOutput: any, reason: string}>}>}
 */
export async function reviewGeneratedCodeWithTests(filePath, code, tests, llmAgent) {
    const prompt = `
# Behavior Review

You are a senior engineer. Decide whether the code would return the expected outputs for each test input.
Return JSON only. If any test would fail, list them with a short reason.

If all tests pass, return:
{ "status": "pass" }

If any test would fail, return:
{
  "status": "fail",
  "failures": [
    { "promptText": "...", "expectedOutput": null, "reason": "..." }
  ]
}

## File Path
${filePath}

## Tests
${JSON.stringify({ tests }, null, 2)}

## Code
${code}
`;

    const response = await llmAgent.executePrompt(prompt, {
        mode: 'deep',
        responseShape: 'json',
        context: { intent: 'review-generated-code-with-tests' },
    });

    const parsed = parseJsonResponse(response, 'Behavior review');
    if (!parsed || (parsed.status !== 'pass' && parsed.status !== 'fail')) {
        throw new Error('Behavior review returned invalid status.');
    }
    if (parsed.status === 'fail') {
        if (!Array.isArray(parsed.failures) || parsed.failures.length === 0) {
            throw new Error('Behavior review returned fail without failures.');
        }
    }
    return parsed;
}

/**
 * Ask LLM to repair a single file based on failures.
 * @param {string} targetPath
 * @param {string} specForPrompt
 * @param {string} backupSpecForPrompt
 * @param {string} generatedCodeForFile
 * @param {Array<{promptText: string, expectedOutput: any, actual?: any, reason?: string}>} failures
 * @param {object} llmAgent
 * @param {string} intent
 * @returns {Promise<string>}
 */
export async function repairGeneratedFile(targetPath, specForPrompt, backupSpecForPrompt, generatedCodeForFile, failures, llmAgent, intent) {
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

## Failed Cases
${JSON.stringify({ failures }, null, 2)}

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
 * Run behavior tests in a temporary directory using Node.
 * @param {string} targetPath
 * @param {string} code
 * @param {Array<{promptText: string, expectedOutput: any}>} tests
 * @returns {Promise<{results: Array<{promptText: string, expectedOutput: any, actual: any, pass: boolean}>}>}
 */
export async function runBehaviorTestsInTemp(targetPath, code, tests) {
    const execFileAsync = promisify(execFile);
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'achilles-mirror-'));
    const normalizedTargetPath = targetPath.replace(/\\/g, '/');
    const outputPath = path.join(tempDir, normalizedTargetPath);
    const testsPath = path.join(tempDir, 'tests.json');
    const runnerPath = path.join(tempDir, 'run-tests.mjs');

    try {
        await fs.mkdir(path.dirname(outputPath), { recursive: true });
        await fs.writeFile(outputPath, code, 'utf-8');
        await fs.writeFile(testsPath, JSON.stringify({ tests }, null, 2), 'utf-8');

        const importPath = `./${normalizedTargetPath}`;
        const runnerCode = `
import fs from 'node:fs/promises';
import path from 'node:path';

const testsRaw = await fs.readFile(path.join(process.cwd(), 'tests.json'), 'utf-8');
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

process.stdout.write(JSON.stringify({ results }));
`;

        await fs.writeFile(runnerPath, runnerCode.trimStart(), 'utf-8');

        const { stdout } = await execFileAsync('node', [runnerPath], { cwd: tempDir, maxBuffer: 10 * 1024 * 1024 });
        const parsed = JSON.parse(stdout);
        if (!parsed || !Array.isArray(parsed.results)) {
            throw new Error('Test runner returned invalid results.');
        }
        return parsed;
    } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
    }
}
