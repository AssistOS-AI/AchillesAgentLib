# Specification for buffer.js - Log Buffer Component

## Module Description
This module implements the core log buffer functionality that stores log messages in memory and manages the buffer state.

## Dependencies
None (pure JavaScript implementation).

---

## Class: LogBuffer

### Description
The `LogBuffer` class manages the storage and retrieval of log messages in an in-memory buffer.

### Constructor
- Initializes an empty array to store log entries
- Sets default buffer limit
- Initializes flush callback

### Properties
- `buffer`: Array storing log entries
- `bufferLimit`: Maximum number of logs before auto-flush
- `flushCallback`: Function to call when buffer is flushed

### Methods

#### log(message, level)
- **Description**: Adds a log message to the buffer
- **Input**:
  - `message` (string): The log message
  - `level` (string, optional): The log level (default: 'info')
- **Output**: `{ success: true, bufferedLogs: number }`
- **Process**:
  1. Creates log entry with message, level, and timestamp
  2. Adds entry to buffer
  3. Checks if buffer limit reached and calls flush if needed
  4. Returns current buffer count

#### getStats()
- **Description**: Returns statistics about buffered logs
- **Output**: `{ totalLogs: number, oldestLog: string, newestLog: string }`
- **Process**: Returns buffer size and first/last log messages

#### flush()
- **Description**: Manually flushes the log buffer
- **Output**: `{ success: true, flushedLogs: number, logs: [...] }`
- **Process**:
  1. Copies current buffer to new array
  2. Clears the buffer
  3. Calls flush callback if set
  4. Returns flushed logs and count

#### setFlushCallback(callback)
- **Description**: Sets the callback function for buffer flush
- **Input**: `callback` (function): Function to call with flushed logs

#### setBufferLimit(limit)
- **Description**: Sets the maximum number of logs before auto-flush
- **Input**: `limit` (number): New buffer limit

---

## Log Entry Structure
```javascript
{
  message: string,    // The log message
  level: string,      // The log level
  timestamp: string   // ISO timestamp
}
```
