# write

## Description
Create or overwrite a file with new content. Creates parent directories if needed.

## Input Format
- **promptText** (string): Key-value pairs (newline or comma-separated) with:
  - `file_path` (required): Absolute or relative path to the file
  - `content` (required): String content to write

Examples:
- `file_path: /abs/path/file.txt\n  content: hello`
- `file_path: relative/path/file.txt\n  content: hello`
- `file_path: /abs/path/config.json\n  content: {"a":1}`
- Multiline content:

```text
file_path: /abs/path/file.txt
content: `Line one
Line two with : and , characters
Line three`
```

Escaped backtick inside content:

```text
file_path: /abs/path/file.txt
content: `Line with \`backtick\` inside`
```

## Output Format
- **Type**: `string`
- Success message: `Wrote <N> characters to <file_path>.`
