# webfetch

## Description
Fetch web content from a URL. HTML is automatically converted to plain text.

## Input Format
- **promptText** (string): Key-value pairs (newline or comma-separated) with:
  - `url` (required): URL to fetch
  - `prompt` (required): Description of what to extract or summarize

Examples:
- `url: https://example.com\n  prompt: summarize`
- `url: https://example.com/docs\n  prompt: extract headings`

## Output Format
- **Type**: `string`
- Plain text content (HTML tags stripped if content-type is text/html)
