# bash

## Description
Run a shell command via bash in the current working directory.

## Input Format
- **promptText** (string): Key-value pairs (newline or comma-separated) with:
  - `command` (required): Shell command to execute
  - `timeout` (optional): Timeout in milliseconds
  - Any value can be wrapped in backticks for multiline input.

Examples:
- `command: ls -la`
- `command: node --version\n  timeout: 60000`
- Multiline command (backticks):

```text
command: `echo "line 1"
```

## Output Format
- **Type**: `string`
- Contains stdout, stderr (if present), exit code (if non-zero), and timeout flag (if timed out)
