# grep

## Description
Search file contents using regex patterns. Supports multiple output modes and context lines.

## Input Format
- **promptText** (string): Key-value pairs (newline or comma-separated) with:
  - `pattern` (required): Regex pattern to search for
  - `path` (optional): Target directory or file path (default: current working directory)
  - `glob` (optional): Glob pattern to filter files (e.g., `*.js`)
  - `output_mode` (optional): Output format - `files_with_matches` (default), `content`, or `count`
  - `-i` (optional): Case-insensitive search
  - `-n` (optional): Include line numbers in content mode
  - `-C` (optional): Context lines before and after matches
  - `-A` (optional): Context lines after matches
  - `-B` (optional): Context lines before matches
  - `multiline` (optional): Enable multiline/dotall mode
  - `head_limit` (optional): Limit number of output lines

Examples:
- `pattern: TODO\n  path: /abs/project\n  output_mode: files_with_matches`
- `pattern: function\\s+\\w+\n  glob: *.js\n  output_mode: content\n  -n: true`

## Output Format
- **Type**: `string`
- Empty string if no matches found
- Format depends on `output_mode`:
  - `files_with_matches`: List of file paths (one per line)
  - `content`: Matching lines with optional file path and line numbers
  - `count`: File paths with match counts (format: `path:count`)
