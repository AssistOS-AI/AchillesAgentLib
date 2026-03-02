# FDS Structure Profile

An FDS (File Design Specification) is a concise technical blueprint for a single source file. It defines the file's responsibilities, boundaries, and externally visible contract, so that implementation can be done consistently and reviewed objectively. It is used when you want a file to be created, refactored, or reviewed with clear intent, stable interfaces, and minimal ambiguity.

Use these required sections in this exact order:

1. Description
2. Dependencies
3. Main Functions
4. Exports
5. Implementation Details

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

If a section has no content, explicitly state so.
