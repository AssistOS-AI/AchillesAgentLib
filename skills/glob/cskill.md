# glob

## Description
Find files by glob pattern. Returns a JSON array of absolute file paths sorted by modification time (most recent first).

## Input Format
- **promptText** (string): A single glob pattern string (e.g., `**/*.js`, `src/**/*.{ts,tsx}`)

Examples:
- `**/*.js`
- `src/**/*.{ts,tsx}`

## Output Format
- **Type**: `string` (JSON array)
- JSON array of absolute file paths sorted by modification time (descending)
- Example: `["/abs/path/file1.js", "/abs/path/file2.js"]`
