# read

## Description
Read file contents from disk. Returns numbered lines for text files and base64 for binary files.

## Input Format
- **promptText** (string): Key-value pairs (newline or comma-separated) with:
  - `file_path` (required): Absolute or relative path to the file
  - `offset` (optional): Starting line number (default: 1)
  - `limit` (optional): Maximum number of lines to return (default: 2000)

Examples:
- `file_path: /abs/path/file.txt`
- `file_path: relative/path/file.txt`
- `file_path: /abs/path/file.txt\n  offset: 101\n  limit: 50`

## Output Format
- **Type**: `string`
- For text files: numbered lines with format `<line_number>\t<content>`
- For binary files: base64-encoded content
