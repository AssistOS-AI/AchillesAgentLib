# Simple In-Memory Cache with TTL

Provides a simple key-value store with automatic expiration.

## Summary
This skill implements an in-memory cache system with time-to-live (TTL) functionality. It allows storing values with expiration times, checking for key existence, and automatic cleanup of expired entries. All operations are exposed through a single, dynamic entry point.

## Input Format
The skill is invoked via an `action` function that accepts a single object specifying the operation to be performed.

- **args** (Object): The container for the command.
  - `operation` (string, mandatory): The operation to perform. Can be `set`, `get`, `has`, or `delete`.
  - `key` (string, mandatory for most operations): The cache key.
  - `value` (any, mandatory for set): The value to store.
  - `ttl` (number, optional for set): Time-to-live in milliseconds.

## Output Format
- **Type**: `any`
- **Description**: The output depends on the operation invoked.
- **Success Examples**:
  - **set**: Returns `{ success: true, key: '...' }`.
  - **get**: Returns the stored value or `null` if not found/expired.
  - **has**: Returns `true` or `false`.
  - **delete**: Returns `{ success: true, deleted: true/false }`.
- **Error Example**: An error is thrown if required parameters are missing.

## Constraints
- Keys must be strings.
- TTL values must be positive numbers.
- Expired entries are automatically removed when accessed.
