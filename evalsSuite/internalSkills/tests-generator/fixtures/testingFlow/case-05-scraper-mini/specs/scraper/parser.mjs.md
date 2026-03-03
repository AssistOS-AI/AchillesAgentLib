# FDS

## Description
Parses anchor tags from HTML and extracts href values.

## Dependencies
- src/scraper/selector.mjs - extractHref : Extracts href attributes from anchor tag strings.

## Main Functions
- parseLinks (html: string) -> string[] Finds anchor tags and extracts href values.
  Inputs: HTML string.
  Outputs: list of href strings; ignores nulls.
  Errors: none.

## Exports
Exports parseLinks as a named function.

## Implementation Details
Uses a regex to match anchor tags with href attributes. Delegates parsing to extractHref.

## Testing
Test parseLinks with HTML containing multiple anchors, including malformed anchors. Ensure it returns only valid hrefs.
