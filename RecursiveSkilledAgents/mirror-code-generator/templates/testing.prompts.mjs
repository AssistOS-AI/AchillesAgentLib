import { buildSourceFilesListing } from './prompt-utils.mjs';

function buildTestPlanPrompt({ testingInstructions, sourceFiles }) {
    const sourceFilesListing = buildSourceFilesListing(sourceFiles);
    return `
# Test Plan Generation

You are an expert test strategist. Read the current codebase and propose a structured test plan.
Your plan must describe which behaviors to test, how to test them, and what test case types are needed.
Prioritize using real code paths and existing utilities. Avoid planning mocks unless a dependency is truly impossible to run (e.g., requires network, credentials, or non-deterministic external services).
When the code reads from disk, include a clear fixtures plan: list the files/folders to create under tests/ (or a clearly stated fixtures directory), and describe their contents at a high level.

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
${sourceFilesListing}

Return ONLY a single JSON object. Do not include markdown fences, commentary, or any extra text.
If you cannot produce a plan, still return {"testPlans": []}.
`;
}

function buildTestFilePrompt({ description, sourceFiles }) {
    const sourceFilesListing = buildSourceFilesListing(sourceFiles);
    return `
# Test File Generation

You are an expert JavaScript test author. Generate one executable test file based on the described plan.
The test file must be runnable with Node.js (ESM) and must write JSON results to stdout.
Prefer integration-style tests that exercise real code paths. Do not create mocks or stubs unless a dependency cannot be executed locally (e.g., requires network access, credentials, or a non-deterministic external service). If a mock is absolutely required, keep it minimal, explain it in code comments, and only mock the smallest surface necessary.
Infer input formats, option syntax, and path handling from the source code itself. Do not invent new formats or behaviors that are not present in the code.
If the tests need files on disk, include them as fixtures in the JSON output so they can be written persistently under the repo (prefer tests/fixtures/... or a clearly stated tests/ subtree).

## Plan Description
${description}

## Source Files
${sourceFilesListing}

## Output Format (STRICT JSON ONLY)
{
  "fileName": "path/to/test-file.mjs",
  "content": "full test file content",
  "testCases": { "any": "json" },
  "fixtures": [
    {
      "path": "tests/fixtures/example.txt",
      "content": "fixture file contents",
      "encoding": "utf-8"
    }
  ]
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
- If fixtures are needed, return them in the "fixtures" array. Each fixture must include a repo-relative path and content. Use "encoding" only when necessary ("utf-8" or "base64").
- Keep fixture paths stable and explicit (avoid temp dirs) so the tests can run consistently in CI.
- If you cannot produce tests, still return a JSON object with "fileName", "content", and an empty "testCases" object.
`;
}

export { buildTestPlanPrompt, buildTestFilePrompt };
