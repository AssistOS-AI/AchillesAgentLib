# DS: rate-limiter skill

## Vision and Problem Statement
Provide a predictable token-bucket rate limiter that can be configured and queried through a simple text request format. This gives skills a consistent way to throttle operations without custom logic.

## Intended Users and Context of Use
Used by internal skills and orchestration flows that need rate limiting from a single input string. Requests are provided as a single input string containing `key: value` pairs.

## Scope and Boundaries
In scope: configuring token bucket rates, consuming tokens, and reporting current status. Out of scope: distributed rate limiting, persistence, or multi-tenant quotas.

## Success Criteria
Rate configuration is applied deterministically. Token consumption returns clear success/failure and remaining tokens. Invalid inputs produce deterministic errors.

## Affected Files
./specs/index.mjs.md - Implements token bucket rate limiting operations. Exports - action entry point for configuring and consuming tokens. Input - single string request payload.
