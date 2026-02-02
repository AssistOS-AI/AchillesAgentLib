# Specification for index.mjs - Log Buffer System

## Module Description
This module implements an in-memory log buffer system that stores log messages and automatically flushes them when the buffer reaches a specified limit. It supports different log levels, provides statistics about buffered logs, and allows manual flushing. The main export is an `action` function that dynamically dispatches calls to the appropriate log buffer methods.

## Dependencies
None (pure JavaScript implementation).

---

## Class: LogBuffer

### Description
The `LogBuffer` class implements the core logging functionality with buffering and auto-flush capabilities. It stores log entries in memory and can automatically flush them when the buffer limit is reached.

### Constructor
- Initializes an empty array to store log entries.
- Sets a default buffer limit of 10 logs.
- Initializes a flush callback that can be set to handle flushed logs.

### Properties
- `buffer`: Array storing log entries.
- `bufferLimit`: Maximum number of logs before auto-flush.
- `flushCallback`: Function to call when logs are flushed.

### Methods

#### log(message, level)
- **Description**: Adds a log message to the buffer.
- **Input**:
  - `message` (string): The log message.
  - `level` (string, optional): The log level (default: 'info').
- **Output**: `{ success: true, bufferedLogs: number }` - Confirmation with current buffer count.
- **Process**:
  1. Creates a log entry with message, level, and timestamp.
  2. Adds the entry to the buffer.
  3. If buffer limit is reached and flush callback is set, calls flush().
  4. Returns success confirmation with current buffer count.

#### getStats()
- **Description**: Returns statistics about the buffered logs.
- **Output**: `{ totalLogs: number, bufferSize: number, oldestLog: string, newestLog: string }`.
- **Process**:
  1. Returns the total number of logs in the buffer.
  2. Returns the oldest and newest log messages (or null if buffer is empty).

#### flush()
- **Description**: Manually flushes the log buffer.
- **Output**: `{ success: true, flushedLogs: number, logs: [...] }` - Flushed logs and count.
- **Process**:
  1. Copies the current buffer to a new array.
  2. Clears the buffer.
  3. If flush callback is set, calls it with the flushed logs.
  4. Returns the flushed logs and count.

#### setFlushCallback(callback)
- **Description**: Sets the callback function to be called when logs are flushed.
- **Input**: `callback` (function): Function to call with flushed logs.

#### setBufferLimit(limit)
- **Description**: Sets the maximum number of logs before auto-flush.
- **Input**: `limit` (number): New buffer limit.

---

## Function: action(args)

### Description
The main exported function and the designated entry point for execution. It acts as a dynamic dispatcher, invoking the appropriate method on the LogBuffer instance based on runtime arguments.

### Input
- `args` (Object):
  - `operation` (string): The operation to perform. Can be `log`, `getStats`, `flush`, or `setBufferLimit`.
  - `message` (string, optional): The log message (required for log operation).
  - `level` (string, optional): The log level (for log operation).
  - `bufferLimit` (number, optional): The buffer limit (for setBufferLimit operation).

### Processing Logic
1. Destructures `operation`, `message`, `level`, and `bufferLimit` from the `args` object.
2. Validates that the operation parameter is present.
3. **For `log` operation**: Validates that message is provided, then calls the `log` method.
4. **For `getStats` operation**: Calls the `getStats` method and returns the result.
5. **For `flush` operation**: Calls the `flush` method and returns the result.
6. **For `setBufferLimit` operation**: Validates that bufferLimit is provided, then calls the `setBufferLimit` method.
7. **For unknown operations**: Throws an error indicating the operation is not supported.

### Output
- **log**: `{ success: true, bufferedLogs: number }` - Confirmation with current buffer count.
- **getStats**: `{ totalLogs: number, bufferSize: number, oldestLog: string, newestLog: string }` - Buffer statistics.
- **flush**: `{ success: true, flushedLogs: number, logs: [...] }` - Flushed logs and count.
- **setBufferLimit**: `{ success: true }` - Confirmation of limit change.

---

## Module Usage

This module exports an `action` function that can be imported and called directly by the CodeSkillsSubsystem.

### Direct Import Usage
```javascript
import { action } from './index.mjs';

// Add log messages
const logResult = await action({
  operation: 'log',
  message: 'This is a test log',
  level: 'info'
});

console.log('Log result:', logResult);

// Get buffer statistics
const statsResult = await action({
  operation: 'getStats'
});

console.log('Stats:', statsResult);

// Manually flush logs
const flushResult = await action({
  operation: 'flush'
});

console.log('Flushed logs:', flushResult.logs);

// Set buffer limit
const limitResult = await action({
  operation: 'setBufferLimit',
  bufferLimit: 5
});

console.log('Limit set:', limitResult);
```

### Integration with CodeSkillsSubsystem
The CodeSkillsSubsystem will dynamically import this module and call the `action` function directly, eliminating the need for child process communication and improving performance and reliability.
