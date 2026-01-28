# Token Bucket Rate Limiter

Implements rate limiting using the token bucket algorithm.

## Summary
This skill implements a token bucket rate limiter that controls the frequency of operations. It supports configurable token refill rates and burst limits. All operations are exposed through a single, dynamic entry point.

## Input Format
The skill is invoked via an `action` function that accepts a single object specifying the operation to be performed.

- **args** (Object): The container for the command.
  - `operation` (string, mandatory): The operation to perform. Can be `setRate`, `consume`, or `getStatus`.
  - `rate` (object, mandatory for setRate): The rate configuration.
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
