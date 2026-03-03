# FDS

## Description
Validates event payloads and coerces them into a normalized event object.

## Dependencies
- src/calendar/event.mjs - buildEvent : Builds the normalized event object from validated fields.

## Main Functions
- validateEvent (event: object) -> object Validates required fields and normalizes types.
  Inputs: event object.
  Outputs: normalized event object.
  Errors: throws when id or title is missing.

## Exports
Exports validateEvent as a named function.

## Implementation Details
Coerces id/title/date to strings and durationMinutes to number. Throws on missing required fields.

## Testing
Test validateEvent with valid input and type coercion. Verify errors on missing id or title.
