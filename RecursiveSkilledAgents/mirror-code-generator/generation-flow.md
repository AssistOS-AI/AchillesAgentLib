# Mirror Code Generator - Current Flow

## High-Level Rules

- Mirror-code-generator operates only on existing `specs/` content inside the target skill directory.
- If `specs/` does not exist, stop immediately.
- For each file in `specs/`, if the spec file is newer than its corresponding code file (or the code file is missing), generation runs.
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
   - If it fails again, revert to the previous on-disk version (or remove the file if none).
4) No tests are generated or executed in this flow. Repairs are limited to syntax failures during generation.

### Common Final Step

- Overwrite `specs/.backup` with the new specs after successful generation.

## Diagram (ASCII)

Start
  |
  v
Check specs/ exists?
  |-- No --> Stop (no specs)
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
  |-- Fail --> Repair (spec + backup + generated code + syntax error)
  |           -> Rewrite -> Recheck
   |           -> Fail? Revert
  |-- Pass --> Continue
  |
  v
Overwrite specs/.backup
  |
  v
Done
