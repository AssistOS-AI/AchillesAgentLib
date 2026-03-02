# DS: simple-cache skill

## Vision and Problem Statement
Provide a small, deterministic in-memory cache with TTL support that can be controlled via a simple text input format. This gives skills a consistent key-value store without external dependencies.

## Intended Users and Context of Use
Used by internal skills and orchestration flows that need caching from a single input string. Requests are provided as a single input string containing `key: value` pairs.

## Scope and Boundaries
In scope: set/get/has/delete operations, TTL expiration, and deterministic responses. Out of scope: persistence, eviction policies beyond TTL, or distributed caching.

## Success Criteria
Cache operations return predictable results and honor TTL expirations. Invalid inputs return deterministic errors.

## Affected Files
./specs/index.mjs.md - Implements in-memory cache operations with TTL. Exports - action entry point for cache operations. Input - single string request payload.
