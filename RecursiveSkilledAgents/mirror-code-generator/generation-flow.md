# Mirror Code Generator - Current Flow

## High-Level Rules

- If the `specs/` folder exists, the process continues; otherwise it stops immediately.
- For each file in `specs/`, if the spec file is newer than its corresponding code file (or the code file is missing), generation runs; otherwise nothing happens.
- Iteration is per spec file (excluding files inside `specs/.backup`).

## Per-File Flow Details

1) Read the spec file.
2) Detect `#Validation` or `#Testing` section (used to guide test generation).

Inputs gathered for code generation:
- Current spec content.
- Corresponding backup spec from `specs/.backup` (if present).
- Corresponding existing code file (if present).

Generation steps:
1) Generate new code from these inputs.
2) Write the new code to its target location inside the skill folder.
3) Run `node --check` on the written file.
   - If it fails, run a repair pass using spec + backup + generated code + syntax error.
   - Re-write the file and re-run `node --check`.
   - If it fails again, revert to the previous on-disk version (or remove the file if none) and skip tests for this file.
4) Generate positive tests and a matching runner (module API is inferred; no fixed contract).
   - If `#Validation/#Testing` exists, that section guides test generation; otherwise a default core prompt is used.
5) Write `tests/test-cases.json` and `tests/run-tests.mjs` to disk (no validation at write time).
6) Validate test artifacts:
   - `node --check` on `tests/run-tests.mjs`
   - `node -e "JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'))" tests/test-cases.json`
   - If either fails, log and skip testing (files remain written).
7) Execute the runner to get `results`.
8) If tests fail, repair using:
   - Spec (authoritative), backup spec, generated code, failure details (name/input/expected/actual), tests, and runner.
   - Priority rule: follow specs first; if possible, keep compatibility with runner/tests.
   - Re-write the file and re-run the same runner/tests (no regeneration).
   - If failures remain, log warnings and keep the code as-is.

### Common Final Step

- Overwrite `specs/.backup` with the new specs.

## Diagram (ASCII)

Start
  |
  v
Check specs/ exists?
  |-- No --> Stop
  |
  v
Check if any spec is newer than its code?
  |-- No --> Stop
  |
  v
For each spec in specs/ (excluding .backup)
  |
  v
Read spec -> Gather spec + backup + existing code
  |
  v
Generate code -> Write to src/
  |
  v
Syntax check (node --check)
  |-- Fail --> Repair (spec + backup + code + syntax error)
  |           -> Rewrite -> Recheck
  |           -> Fail? Revert + skip tests
  |-- Pass --> Continue
  |
  v
Generate tests + runner (use #Validation/#Testing if present)
Write tests/test-cases.json + tests/run-tests.mjs
Validate runner + cases JSON
  |-- Fail --> Log + skip tests
  |-- Pass --> Run tests
  |
  v
Failures? -> Repair (specs first, then runner/tests)
          -> Rewrite -> Rerun same runner/tests
          -> Warn if still failing
  |
  v
Overwrite specs/.backup with new specs
  |
  v
Done
