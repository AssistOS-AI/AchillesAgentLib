# Mirror Code Generator - Expected Flow (as described)

This document captures the expected behavior you described, with no omissions.

## High-Level Rules

- If the `specs/` folder exists, the process continues; otherwise it stops immediately.
- For each file in `specs/`, if the spec file is newer than its corresponding code file, generation runs; otherwise nothing happens.
- Iteration is per spec file (excluding files inside `specs/.backup`).

## Per-File Flow Details

1) Read the spec file.
2) Check if the spec contains a `#Validation` or `#Testing` section.

### Case 1: Validation/Testing section exists

Inputs gathered for code generation:
- Current spec content.
- Corresponding backup spec from `specs/.backup` (if present).
- Corresponding existing code file (if present).

Generation steps:
1) Generate new code from these inputs.
2) Use new code + new specs (excluding .backup) to request positive test cases from the LLM (explicitly positive only).
3) Write the new code to a temporary folder under `/tmp`.
4) Run the new code using a runner and the generated test cases.
5) Store results for each test (input, expected, actual).

Repair loop:
- If one or more tests fail:
  - Send all failing case details + new code (generated) + current specs to the LLM for a fix.
  - Write the repaired code to `/tmp` and run tests again.
  - If tests fail again, log a warning in the console with all failing cases.

Finalization:
- Write the final code to its target location inside the skill folder, regardless of test outcome.

### Case 2: No Validation/Testing section

Generation steps:
1) Generate new code as in Case 1 (same inputs).
2) Generate positive test cases as in Case 1 (using new code + new specs, excluding .backup).

Validation (LLM-only):
- Provide the LLM with the generated tests and the generated code.
- Ask if all tests would pass for the new code.
- If yes, write the code to its final location.
- If no, require the LLM to report which tests would fail and why.

Repair:
- Provide the LLM response, the new code (generated), and the new specs (excluding backup) to fix the code.
- Write the repaired code to its final location in the skill folder.

### Common Final Step (both cases)

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
Read spec -> Has #Validation or #Testing?
  |-- Yes --> Case 1
  |           - Gather spec + backup spec + existing code
  |           - Generate code
  |           - Generate positive tests (explicitly positive only, based on new code + new specs)
  |           - Run in /tmp with runner
  |           - Failures? -> repair -> rerun -> warn if still failing
  |           - Write code to final location
  |
  |-- No --> Case 2
              - Generate code (same inputs)
              - Generate positive tests (same as Case 1, based on new code + new specs)
              - LLM review of test pass/fail
              - If pass -> write code
              - If fail -> list failing tests + reason
                           -> repair -> write code
  |
  v
Overwrite specs/.backup with new specs
  |
  v
Done
