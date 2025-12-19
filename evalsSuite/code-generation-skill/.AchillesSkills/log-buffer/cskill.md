# Log Buffer System

Stores log messages in memory and flushes them when the buffer is full.

## Summary
This skill implements an in-memory log buffer system that stores log messages and automatically flushes them when the buffer reaches a specified limit. It supports different log levels and provides statistics about the buffered logs. All operations are exposed through a single, dynamic entry point.

## Input Format
The skill is invoked via an `action` function that accepts a single object specifying the operation to be performed.

- **args** (Object): The container for the command.
  - `operation` (string, mandatory): The operation to perform. Can be `log`, `getStats`, or `flush`.
  - `message` (string, mandatory for log): The log message.
  - `level` (string, optional for log): The log level (e.g., 'info', 'error').
  - `bufferLimit` (number, optional): The maximum number of logs before auto-flush.

## Output Format
- **Type**: `object`
- **Description**: The output depends on the operation invoked.
- **Success Examples**:
  - **log**: Returns `{ success: true, bufferedLogs: number }`.
  - **getStats**: Returns `{ totalLogs: number, bufferSize: number, oldestLog: string, newestLog: string }`.
  - **flush**: Returns `{ success: true, flushedLogs: number, logs: [...] }`.
- **Error Example**: An error is thrown if required parameters are missing.

## Constraints
- The `message` must be a string for log operations.
- Buffer limit must be a positive number.
- Log levels are optional but recommended for filtering.
