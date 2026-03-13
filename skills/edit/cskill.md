# edit

## Description
Replace exact text in a file. Supports single or multiple replacements.

## Input Format
- **promptText** (string): Key-value pairs (newline or comma-separated) with:
  - `file_path` (required): Absolute or relative path to the file
  - `old_string` (required): Exact text to find and replace
  - `new_string` (required): Replacement text
  - `replace_all` (optional): Set to `true` to replace all occurrences (default: false)

Examples:
- `file_path: /abs/path/file.txt\n  old_string: foo\n  new_string: bar`
- `file_path: relative/path/file.txt\n  old_string: foo\n  new_string: bar`
- `file_path: /abs/path/app.js\n  old_string: debug=true\n  new_string: debug=false\n  replace_all: true`

## Output Format
- **Type**: `string`
- Success message: `Updated <file_path>.`
