# FDS

## Description
Builds normalized event objects from raw input fields.

## Dependencies
None.

## Main Functions
- buildEvent (params: { id: string, title: string, date: string, durationMinutes: number }) -> object Builds an event object.
  Inputs: event fields.
  Outputs: event object with id, title, date, durationMinutes.
  Errors: none.

## Exports
Exports buildEvent as a named function.

## Implementation Details
Returns a plain object with provided fields. No external dependencies.

## Testing
Test buildEvent returns the expected object and preserves provided field values.
