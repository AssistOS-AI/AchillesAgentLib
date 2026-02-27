# tests-generator

## Summary
Generates tests for a skill directory based on existing source files. It produces test plans, writes test files under `tests/`, and ensures a `runAll.mjs` test runner template exists. It does not execute the tests.

## Input Format
- **prompt** (string): Absolute or relative path to the target skill directory containing `src/` code to test.

Rules:
- The prompt must point to a directory, not a single file.
- If no source files are provided or discovered, tests are skipped.

Examples:
- "./skills/inventory"
- "/path/to/my-skill"

## Output Format
- **Type**: `object`
- **Success Example**:
  ```json
  {
    "message": "Test generation completed for ./skills/inventory",
    "testResults": {
      "skipped": false
    }
  }
  ```
- **Error Example**: "Error: tests-generator requires a skill directory path as input."

## Constraints
- Tests are written under `tests/` and a `tests/runAll.mjs` runner is created if missing.
- Test execution is handled by other skills or callers.
