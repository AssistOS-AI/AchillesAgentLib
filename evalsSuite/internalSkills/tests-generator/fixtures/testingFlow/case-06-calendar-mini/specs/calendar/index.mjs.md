# FDS

## Description
Provides calendar entry APIs to create and list formatted events. Coordinates validation, storage, and formatting.

## Dependencies
- src/calendar/store.mjs - addEvent : Persists validated events.
- src/calendar/store.mjs - listEvents : Reads stored events.
- src/calendar/validator.mjs - validateEvent : Validates and normalizes event input.
- src/calendar/formatter.mjs - formatEvent : Formats event objects for output.

## Main Functions
- createEvent (event: object) -> string Validates, stores, and formats an event.
  Inputs: event payload object.
  Outputs: formatted event string.
  Errors: throws when validation fails.
- listFormattedEvents () -> string[] Returns formatted strings for all stored events.
  Inputs: none.
  Outputs: array of formatted strings.
  Errors: none.

## Exports
Exports createEvent and listFormattedEvents as named functions.

## Implementation Details
Uses validateEvent to coerce inputs, addEvent to persist, and formatEvent for string output. Operates on in-memory storage.

## Testing
Test createEvent with valid input and verify formatted output and storage. Test createEvent error on missing required fields. Test listFormattedEvents after adding multiple events.
