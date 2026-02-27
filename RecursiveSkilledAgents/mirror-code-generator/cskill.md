# mirror-code-generator

## Summary
Generates JavaScript/ESM code from a skill's `specs/` directory. It reads `.md/.mds` spec files, produces or updates matching `src/` files, optionally generates tests via the tests-generator skill, and backs up specs to `specs/.backup` after a successful run.

## Input Format
- **prompt** (string): Absolute or relative path to the target skill directory that contains a `specs/` folder.

Rules:
- The prompt must point to a directory, not a single spec file.
- If no `specs/` directory exists, the skill returns without generating code.

Examples:
- "./skills/inventory"
- "/path/to/my-skill"

## Output Format
- **Type**: `object`
- **Success Example**:
  ```json
  {
    "message": "Code generation completed for ./skills/inventory",
    "generatedFiles": ["src/index.mjs", "src/utils/helpers.mjs"]
  }
  ```
- **Error Example**: "Error: mirror-code-generator requires a skill directory path as input."

## Constraints
- Only `.md/.mds` files inside `specs/` are considered.
- Generated files are written under `src/` based on spec path.
- If syntax checks fail, the skill attempts repair; on repeated failure it reverts the file and skips tests.
