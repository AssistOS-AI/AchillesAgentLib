# FDS

## Description
Normalizes an order record by returning a shallow copy with a normalized flag.

## Dependencies
None.

## Main Functions
- mapRecord (record: object) -> object Returns a copy of the record with normalized set to true.
  Inputs: order record object.
  Outputs: new object with normalized: true.
  Errors: none.

## Exports
Exports mapRecord as a named function.

## Implementation Details
Shallow copies the record via spread and adds a normalized flag. No external dependencies.

## Testing
Test that mapRecord preserves input fields and adds normalized: true without mutating the original object.
