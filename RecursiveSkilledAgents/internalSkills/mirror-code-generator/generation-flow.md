# Mirror Code Generator - Current Flow

## High-Level Rules

- Check for DS files and determine whether any listed FDS outputs are missing or older than their DS sources.
- Run `fds-generator` only when that condition is true (or when `specs/` is missing).
- If `specs/` does not exist after the FDS step (no DS and no specs), stop immediately.
- For each file in `specs/`, if the spec file is newer than its corresponding code file (or the code file is missing), generation runs.
- If no files need regeneration but the `tests/` folder is missing, generate tests only and stop.
- Iteration is per spec file (excluding files inside `specs/.backup`).

## Per-File Flow Details

1) Read the spec file.

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
4) Build a test plan from the current on-disk codebase (no specs provided).
5) Generate one or more executable test files plus optional fixtures (UTF-8 text).
6) Write the tests and fixtures under `tests/` (create folders as needed), then syntax-check each test file.
7) Ensure `tests/runAll.mjs` exists (copied from a template when missing).
8) Execute `tests/runAll.mjs` to run all `.mjs`/`.js` files under `tests/` recursively.
9) If tests fail, repair iteratively across referenced source files, then re-run once.
   - If a file is not responsible, the repair step should return it unchanged.
   - If failures remain, log warnings and keep the code as-is.

### Tests-Only Flow (No Regeneration)

If all spec files are up-to-date but `tests/` is missing:
- Build a test plan from the current on-disk codebase (no specs provided).
- Generate executable test files and optional fixtures.
- Ensure `tests/runAll.mjs` exists, then run it.
- Log failures without repairing the code.
- Stop after tests are generated; do not update `specs/.backup`.

### Common Final Step

- Overwrite `specs/.backup` with the new specs (skipped when only tests were generated).

## Diagram (ASCII)

Start
  |
  v
Check for DS files?
  |-- No --> Skip fds-generator
  |
  v
DS files found -> specs missing or any FDS older than DS?
  |-- No --> Skip fds-generator
  |-- Yes --> Run fds-generator
  |
  v
Check specs/ exists?
  |-- No --> Stop (no DS and no specs)
  |
  v
Check if any spec is newer than its code?
  |-- No --> Tests missing?
  |           |-- Yes --> Generate tests only (no backup spec, no backup update) --> Done
  |           |-- No  --> Stop
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
  |-- Fail --> Repair (spec + backup + generated code + syntax error)
  |           -> Rewrite -> Recheck
  |           -> Fail? Revert + skip tests
  |-- Pass --> Continue
  |
  v
Build test plan from current codebase
Generate test files + optional fixtures
Write tests/ (create folders as needed) and fixtures
Syntax-check each test file
Ensure tests/runAll.mjs (copy template if missing)
Run tests/runAll.mjs (executes all .mjs/.js under tests/)
Failures? -> Repair iteratively across referenced source files
          -> Rerun once
          -> Warn if still failing
  |
  v
Overwrite specs/.backup
  |
  v
Done
