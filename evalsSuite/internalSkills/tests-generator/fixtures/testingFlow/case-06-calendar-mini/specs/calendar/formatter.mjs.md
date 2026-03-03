# FDS

## Description
Formats event objects into a pipe-delimited string.

## Dependencies
None.

## Main Functions
- formatEvent (event: object) -> string Formats an event as "id|title|date|durationMinutes".
  Inputs: event object.
  Outputs: formatted string.
  Errors: none.

## Exports
Exports formatEvent as a named function.

## Implementation Details
Uses template string with event fields in fixed order.

## Testing
Test formatEvent with a sample event and ensure correct output formatting.
