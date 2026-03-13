# glob

## Description
Find files by glob pattern. Returns a JSON array of absolute file paths sorted by modification time (most recent first).

## Input Format
- **promptText** (string): Key-value pairs (newline or comma-separated) with:
  - `pattern` (required): Glob pattern (e.g., `**/*.js`, `src/**/*.{ts,tsx}`)
  - `path` (optional): Base directory to search from (default: current working directory)

Examples:
- `pattern: **/*.js`
- `pattern: **/*.js\n  path: src`
- `pattern: src/**/*.{ts,tsx}\n  path: /abs/project`

## Output Format
- **Type**: `string` (JSON array)
- JSON array of absolute file paths sorted by modification time (descending)
- Example: `["/abs/path/file1.js", "/abs/path/file2.js"]`
