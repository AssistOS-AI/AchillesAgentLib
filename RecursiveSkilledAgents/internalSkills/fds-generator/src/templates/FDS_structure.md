# FDS Structure Profile

An FDS (File Design Specification) is a concise technical blueprint for a single source file. It defines the file's responsibilities, boundaries, and externally visible contract, so that implementation can be done consistently and reviewed objectively. It is used when you want a file to be created, refactored, or reviewed with clear intent, stable interfaces, and minimal ambiguity.

Use these required sections in this exact order:

1. Description
2. Dependencies
3. Main Functions
4. Exports
5. Implementation Details
6. Testing

## Section Guidance

Description: Thoroughly describe the file’s purpose, responsibilities, and role in the system. State the artifact type such as class, utility module, adapter, interface, CLI command, schema, or configuration loader, and clarify what the file explicitly does not do.

Dependencies: List only file-level dependencies where descriptions can be pulled from other FDS files. Use a strict one-line format per item: `path/to/file - functionName : reason`. The reason is required and explains where and why the dependency is used. Do not include signatures here. Do not list npm packages or Node.js built-ins; cover those in Implementation Details.

Example Dependencies section:

## Dependencies
- src/utils/normalize.mjs - normalizeQuery : Used to normalize user search input before parsing.
- src/search/tokenize.mjs - tokenizeQuery : Used to split normalized input into tokens for matching.

Main Functions: Provide a list of function entries using `-` as the strict item separator. Each item starts with `- functionName params description` and may span multiple lines to explain inputs, outputs, errors, edge cases, and behavior. Do not start description lines with `-` (hyphen) to keep parsing unambiguous.

Example Main Functions section:

## Main Functions
- parseQuery (raw: string) -> string[] Parses input, splits by commas, trims tokens.
  Inputs: raw string; rejects null/undefined.
  Outputs: array of tokens; empty list when input is empty.
  Errors: throws on invalid input types.
- buildMatcher (tokens: string[], mode: 'all' | 'any') -> MatcherFn Builds a predicate.
  Inputs: tokens list, mode selector.
  Outputs: matcher function.
  Errors: throws on empty tokens.

Exports: Describe exactly what the file exports and how consumers should use it. Include the public surface area, stability expectations, and any backward-compatibility constraints.

Implementation Details: Provide general implementation rules and constraints such as performance targets, logging or telemetry, error handling conventions, security or privacy considerations, concurrency model, idempotency, and testing expectations. Include npm packages or Node.js built-ins used by the file.

Testing: Provide structured guidance using one or more bullet entries in the format below. Each entry MUST include: test type, checks, inputs (high-level), expected output, guardrails, and fixtures/cases. If a field is not applicable, explicitly state that (e.g., "No fixtures needed", "No guardrails needed", "No output expected; must not error"). If there is no meaningful logic to test (e.g., re-export-only modules, static constants, type-only files, or thin wrappers), state that explicitly and give the reason.

Testing section format (repeat per test type):
- Test Type (unit/integration/flow/e2e/negative/etc.):
  Checks: <what is verified>
  Inputs: <high-level inputs>
  Expected Output: <high-level expected outputs>
  Guardrails: <error detection or safety checks; or "No guardrails needed">
  Fixtures/Cases: <high-level fixtures or cases; or "No fixtures needed">

Example Testing section:

## Testing
- Test Type (unit):
  Checks: parser returns correct token array and rejects malformed input.
  Inputs: string of 20-50 chars with commas; invalid string missing commas.
  Expected Output: array of tokens; error message for invalid input.
  Guardrails: verify errors include "invalid format" and no partial tokens leak.
  Fixtures/Cases: No fixtures needed.
- Test Type (negative):
  Checks: empty input is rejected gracefully.
  Inputs: empty string, whitespace-only string.
  Expected Output: no output expected; must not throw uncaught errors.
  Guardrails: ensure response includes a clear error indicator.
  Fixtures/Cases: No fixtures needed.

If a section has no content, explicitly state so.
