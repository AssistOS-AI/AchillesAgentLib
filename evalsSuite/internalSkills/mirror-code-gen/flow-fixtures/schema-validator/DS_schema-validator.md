# DS: schema-validator skill

## Vision and Problem Statement
Provide a schema validator that checks JSON-like objects against simple rules using a consistent text-based request format. This reduces duplicated validation logic.

## Intended Users and Context of Use
Used by any component that needs schema validation from a single input string. The request is a single string containing one `key: value` pair per line.

## Scope and Boundaries
In scope: basic type validation, min/max constraints, and returning structured error lists. Out of scope: advanced schema languages, code generation, and external validators.

## Success Criteria
Valid data returns `{ valid: true, errors: [] }`. Invalid data returns `{ valid: false, errors: [...] }` with field-specific errors. Malformed input returns a clear error message.

## Affected Files
./specs/index.mjs.md - Implements schema validation operations. Exports - action entry point that accepts a single string request payload and returns validation results.
