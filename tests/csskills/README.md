# Code Specs Skills Tests

This directory contains tests for the Code Specs Skills subsystem.

## Test Files

### `smoke.test.mjs`
Basic smoke test that verifies the code generation and execution flow:
- Tests LLM argument extraction
- Tests code generation from specifications
- Tests execution of generated code
- Tests cleanup of generated files

### `code-regeneration.test.mjs`
Comprehensive test that verifies the signature-based code regeneration logic:

**Test 1: Initial Code Generation**
- Verifies that code is generated from specifications
- Checks that generated code contains expected logic
- Confirms no unnecessary modules are included

**Test 2: No Regeneration When Specs Unchanged**
- Tests that code is NOT regenerated when specifications haven't changed
- Verifies fast completion when using cached signatures

**Test 3: Regeneration When Specs Change**
- Adds a new specification file (`new-module.js.md`)
- Verifies that code IS regenerated when specifications change
- Checks that regenerated code includes the new module

**Test 4: Execution with Regenerated Code**
- Executes the skill with the regenerated code
- Verifies that execution produces correct results

**Test 5: Cleanup**
- Removes the test specification file
- Deletes the generated code directory
- Ensures no test artifacts remain

## Running Tests

To run all tests in this directory:

```bash
node smoke.test.mjs
node code-regeneration.test.mjs
```

## Test Structure

All tests use a mock LLM agent that:
- Generates predictable code from specifications
- Extracts arguments in a consistent manner
- Avoids actual LLM API calls for reliable testing

The tests verify the complete lifecycle:
1. Skill discovery and preparation
2. Code generation from specifications
3. Execution of generated code
4. Code regeneration when specifications change
5. Proper cleanup and signature caching