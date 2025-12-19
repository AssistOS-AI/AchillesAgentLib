# Retry Mechanism with Exponential Backoff

Implements a retry utility with exponential backoff for error-prone functions.

## Summary
This skill provides a retry mechanism that automatically re-executes failed functions with increasing delays between attempts. It supports configurable retry counts and base delay times. All operations are exposed through a single, dynamic entry point.

## Input Format
The skill is invoked via an `action` function that accepts a single object specifying the operation to be performed.

- **args** (Object): The container for the command.
  - `operation` (string, mandatory): The operation to perform. Currently only `retry` is supported.
  - `function` (function, mandatory): The function to retry.
  - `args` (array, optional): Arguments to pass to the function.
  - `retries` (number, optional): Maximum number of retry attempts (default: 3).
  - `baseDelay` (number, optional): Base delay in milliseconds for exponential backoff (default: 100).

## Output Format
- **Type**: `object`
- **Description**: The output depends on the operation invoked.
- **Success Examples**:
  - **retry**: Returns `{ success: true, result: any, attempts: number, totalTime: number }`.
- **Error Example**: Returns `{ success: false, error: string, attempts: number }` if all retries fail.

## Constraints
- The function parameter must be a valid function.
- Retries must be a positive integer.
- Base delay must be a positive number.
- The function should be designed to handle retry attempts appropriately.
