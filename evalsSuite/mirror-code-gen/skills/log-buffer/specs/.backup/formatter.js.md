# Specification for formatter.js - Log Formatter Component

## Module Description
This module implements log formatting functionality that adds timestamps and log levels to raw log messages.

## Dependencies
None (pure JavaScript implementation).

---

## Function: formatLog(message, level)

### Description
Formats a raw log message by adding timestamp and log level information.

### Input
- `message` (string): The raw log message
- `level` (string, optional): The log level (default: 'info')

### Output
- Returns a formatted log entry object

### Processing Logic
1. **Create Entry**: Creates a new log entry object
2. **Add Message**: Sets the message property
3. **Add Level**: Sets the level property (defaults to 'info')
4. **Add Timestamp**: Sets the timestamp to current ISO string
5. **Return Entry**: Returns the formatted log entry

### Example
```javascript
const formatted = formatLog("User logged in", "info");
// Returns:
// {
//   message: "User logged in",
//   level: "info",
//   timestamp: "2023-12-19T12:34:56.789Z"
// }
```

---

## Function: formatLevel(level)

### Description
Formats and validates log levels.

### Input
- `level` (string): The log level to format

### Output
- Returns the formatted log level

### Processing Logic
1. **Validate**: Checks if level is a valid log level
2. **Normalize**: Converts to lowercase
3. **Default**: Returns 'info' if invalid

---

## Integration
This module is used by the main `logger.js` component to format log messages before they are stored in the buffer.
