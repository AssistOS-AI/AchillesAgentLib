import { buildFdsSectionsListing, buildSourceFilesListing } from './prompt-utils.mjs';

function buildTestPlanPrompt({ fdsEntries }) {
    const fdsSectionsListing = buildFdsSectionsListing(fdsEntries);
    return `
# Test Plan Generation

You are an expert test strategist. Read the current codebase and propose a structured test plan.
Your plan must describe which behaviors to test, how to test them, and what test case types are needed. Also you need to identify which source code files are tied to the tests proposed in the plan.
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

## Instructions
Propose the minimum set of tests that cover the core functionality of the code. Usually if the source code is only one file, one test is enough. Avoid creating additional directories unless you have a lot of tests that need to be done.
Each plan should describe what functionality to test, how to test it, and what kinds of cases are needed.
Base the plan only on the FDS sections shown.
Return only JSON in the requested format.

## Here are the specifications for the current code, each with its testing instructions. You need to follow them as much as possible when designing the plan.
${fdsSectionsListing}

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
If the tests need test cases/fixtures files on disk, include them as fixtures in the JSON output so they can be written persistently under the repo (prefer tests/fixtures/... or a clearly stated tests/ subtree).

## Below is the description of the test that needs to be implemented:
${description}

## Below are source code files that need to be tested:
${sourceFilesListing}

## Output Format (STRICT JSON ONLY)
{
  "fileName": "path/to/test-file.mjs",
  "content": "full test file content",
  "fixtures": [
    {
      "path": "tests/fixtures/example.txt",
      "content": "fixture file contents"
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
- If fixtures are needed, return them in the "fixtures" array. Each fixture must include a repo-relative path and UTF-8 text content.
- Keep fixture paths stable and explicit (avoid temp dirs) so the tests can run consistently in CI.
- If you cannot produce tests, still return a JSON object with "fileName" and "content", and an empty fixtures array.
`;
}

export { buildTestPlanPrompt, buildTestFilePrompt };
