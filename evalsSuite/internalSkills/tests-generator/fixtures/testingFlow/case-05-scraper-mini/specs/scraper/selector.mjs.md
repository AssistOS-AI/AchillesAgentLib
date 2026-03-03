# FDS

## Description
Extracts the href value from an anchor tag string.

## Dependencies
None.

## Main Functions
- extractHref (tag: string) -> string | null Extracts href attribute value from a tag.
  Inputs: anchor tag string.
  Outputs: href string or null if missing.
  Errors: none.

## Exports
Exports extractHref as a named function.

## Implementation Details
Uses a case-insensitive regex to capture href attribute value.

## Testing
Test extractHref for tags with double and single quotes, mixed case, and missing href (returns null).
