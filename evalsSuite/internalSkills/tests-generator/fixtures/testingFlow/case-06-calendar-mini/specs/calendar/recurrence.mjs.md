# FDS

## Description
Expands a recurring event into multiple instances with incremented identifiers.

## Dependencies
None.

## Main Functions
- expandRecurrence (event: object, count: number) -> object[] Creates a list of recurring events.
  Inputs: base event and count.
  Outputs: array of cloned events with id suffixes.
  Errors: none.

## Exports
Exports expandRecurrence as a named function.

## Implementation Details
Builds a new array of size count and appends "-N" suffix to each id.

## Testing
Test expandRecurrence for count 0 (empty), 1, and multiple. Ensure id suffix increments and other fields are preserved.
