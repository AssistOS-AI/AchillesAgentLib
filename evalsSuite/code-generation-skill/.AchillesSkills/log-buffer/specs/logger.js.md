# Specification for logger.js - Log Buffer Main Component

## Module Description
This module implements the main logging functionality that coordinates the buffer and formatter components.

## Dependencies
- `./buffer.js`: Log buffer functionality
- `./formatter.js`: Log formatting functionality

---

## Class: LogBuffer

### Description
The `LogBuffer` class provides the complete logging functionality with buffering and auto-flush capabilities.

### Constructor
- Initializes buffer and formatter components
- Sets up the logging system

### Properties
- `buffer`: Instance of the buffer component
- `formatter`: Instance of the formatter component

### Methods

#### log(message, level)
- **Description**: Adds a formatted log message to the buffer
- **Input**:
  - `message` (string): The log message
  - `level` (string, optional): The log level
- **Output**: `{ success: true, bufferedLogs: number }`
- **Process**:
  1. Formats the message using formatter
  2. Adds to buffer using buffer component
  3. Returns current buffer count

#### getStats()
- **Description**: Gets buffer statistics
- **Output**: Statistics object with log count and sample messages

#### flush()
- **Description**: Flushes the log buffer
- **Output**: `{ success: true, flushedLogs: number, logs: [...] }`

#### setFlushCallback(callback)
- **Description**: Sets the flush callback function
- **Input**: `callback` (function): Function to call on flush

#### setBufferLimit(limit)
- **Description**: Sets the buffer limit
- **Input**: `limit` (number): Maximum logs before auto-flush

---

## Integration
This module is used by the main `index.js` component to provide the complete logging functionality.
