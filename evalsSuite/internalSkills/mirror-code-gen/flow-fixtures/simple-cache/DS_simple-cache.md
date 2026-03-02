# DS: simple-cache skill

## Vision and Problem Statement
Provide a small in-memory cache with TTL support that can be controlled via a simple text input format. This gives callers a consistent key-value store without external dependencies.

## Intended Users and Context of Use
Used by any component that needs caching from a single input string. The request is a single string containing one `key: value` pair per line.

## Scope and Boundaries
In scope: set/get/has/delete operations, TTL expiration, and consistent responses. Out of scope: persistence, eviction policies beyond TTL, and distributed caching.

## Success Criteria
Cache operations return expected results and honor TTL expirations. Invalid input returns a clear error message.

## Affected Files
./specs/index.mjs.md - Implements in-memory cache operations with TTL. Exports - action entry point that accepts a single string request payload and returns cache results.
