# Token Bucket Rate Limiter

Implements rate limiting using the token bucket algorithm.

## Description
This skill implements a token bucket rate limiter that controls the frequency of operations. It supports configurable token refill rates and burst limits. All operations are exposed through a single, dynamic entry point.

## Input Format
The skill is invoked via an `action` function that accepts an object with a `promptText` string. The `promptText` must use `key: value` pairs, one per line.

- **promptText** (string): Multi-line text containing `key: value` pairs.
  - `operation` (string, mandatory): `setRate`, `consume`, or `getStatus`.
  - `rate` (object, mandatory for setRate): JSON string for the rate object.
  - `tokens` (number, mandatory for consume): Number of tokens to consume.

## Output Format
- **Type**: `object`
- **Description**: The output depends on the operation invoked.
- **Success Examples**:
  - **setRate**: Returns `{ success: true }`.
  - **consume**: Returns `{ success: true, remaining: number }` or `{ success: false, remaining: number }`.
  - **getStatus**: Returns `{ tokens: number, rate: object }`.
- **Error Example**: An error is thrown if required parameters are missing.

## Constraints
- Rate configuration must include tokensPerSecond and burstLimit.
- Token consumption cannot exceed available tokens.
- Rate limiting is based on system time.
