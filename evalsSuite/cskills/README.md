# Code Skills Evals

This directory contains evaluations for the CodeSkillsSubsystem — testing code generation, execution, and regeneration via `mirror-code-generator`.

## Fixtures

### `skills/format-user/`
A cskill that formats user data (name, age) into a readable string.
- `cskill.md` — skill descriptor with input/output format
- `specs/index.js.md` — functional specification for code generation
- `specs/.backup/` — backup of original spec

### `skills/generate-text/`
A cskill that produces text content using the LLM.
- `cskill.md` — skill descriptor
- `specs/index.mjs.md` — functional specification
- `specs/.backup/` — backup of original spec

## Eval Files

### `evalCodeRegeneration.mjs`
Comprehensive eval that verifies the complete lifecycle of cskill code generation and regeneration:

**Test 1: Initial Code Generation**
- Verifies that code is generated from specifications on first execution
- Checks that generated code contains expected logic
- Confirms no unnecessary modules are included

**Test 2: No Regeneration When Specs Unchanged**
- Tests that code is NOT regenerated when specifications haven't changed
- Verifies fast completion when code already exists

**Test 3: Regeneration When Specs Change**
- Adds a new specification file (`new-module.js.md`)
- Verifies that code IS regenerated when specifications change
- Checks that regenerated code includes the new module

**Test 4: Execution with Regenerated Code**
- Executes the skill with the regenerated code
- Verifies that execution produces correct results

**Test 5: Cleanup**
- Removes all test artifacts

## Running Evals

```bash
node evalsSuite/cskills/evalCodeRegeneration.mjs
```

Requires an LLM API key (any configured provider).
