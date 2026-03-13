# bash

## Description
Run a shell command via bash in the current working directory.

## Input Format
- **promptText** (string): Key-value pairs (newline or comma-separated) with:
  - `command` (required): Shell command to execute
  - `timeout` (optional): Timeout in milliseconds

Examples:
- `command: ls -la`
- `command: node --version\n  timeout: 60000`

## Output Format
- **Type**: `string`
- Contains stdout, stderr (if present), exit code (if non-zero), and timeout flag (if timed out)
