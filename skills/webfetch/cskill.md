# webfetch

## Description
Fetch web content from a URL. HTML is automatically converted to plain text.

## Input Format
- **promptText** (string): Key-value pairs (newline or comma-separated) with:
  - `url` (required): URL to fetch
  - `prompt` (required): Description of what to extract or summarize
  - Any value can be wrapped in backticks for multiline input.

Examples:
- `url: https://example.com\n  prompt: summarize`
- `url: https://example.com/docs\n  prompt: extract headings`
- Multiline prompt (backticks):

```text
url: https://example.com/docs
prompt: `Summarize the sections.
List headings and key points.`
```

## Output Format
- **Type**: `string`
- Plain text content (HTML tags stripped if content-type is text/html)
