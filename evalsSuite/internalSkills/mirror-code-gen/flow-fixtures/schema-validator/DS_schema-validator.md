# DS: schema-validator skill

## Vision and Problem Statement
Provide a deterministic schema validator that can validate JSON-like objects against simple rules using a consistent text-based request format. This reduces duplicated validation logic across skills.

## Intended Users and Context of Use
Used by internal skills and orchestration flows that need schema validation from a single input string. Requests are provided as a single input string containing `key: value` pairs.

## Scope and Boundaries
In scope: basic type validation, min/max constraints, and returning structured error lists. Out of scope: advanced schema languages, code generation, or external validators.

## Success Criteria
Valid data returns a clear `{ valid: true, errors: [] }` response. Invalid data returns deterministic error lists. Malformed input produces consistent errors.

## Affected Files
./specs/index.mjs.md - Implements schema validation operations. Exports - action entry point for validating data. Input - single string request payload.
