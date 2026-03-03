# FDS

## Description
Ensures relative paths have a leading slash.

## Dependencies
None.

## Main Functions
- ensureLeadingSlash (value: string) -> string Adds a leading slash if missing.
  Inputs: string value.
  Outputs: string with leading slash.
  Errors: none.

## Exports
Exports ensureLeadingSlash as a named function.

## Implementation Details
Simple string prefix check; no external dependencies.

## Testing
Test with values that already start with '/', values without '/', and empty string.
