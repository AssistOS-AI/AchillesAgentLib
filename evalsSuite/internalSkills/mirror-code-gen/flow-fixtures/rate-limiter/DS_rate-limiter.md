# DS: rate-limiter skill

## Vision and Problem Statement
Provide a token-bucket rate limiter that can be configured and queried through a simple text request format. This gives callers a consistent way to throttle operations.

## Intended Users and Context of Use
Used by any component that needs rate limiting from a single input string. The request is a single string containing one `key: value` pair per line.

## Scope and Boundaries
In scope: configuring token bucket rates, consuming tokens, and reporting current status. Out of scope: distributed rate limiting, persistence, and multi-tenant quotas.

## Success Criteria
Given the same input, rate configuration yields the same internal state. Token consumption returns a clear success/failure result and remaining token count. Invalid input returns a clear error message.

## Affected Files
./specs/index.mjs.md - Implements token bucket rate limiting operations. Exports - action entry point that accepts a single string request payload and returns status or consumption results.
