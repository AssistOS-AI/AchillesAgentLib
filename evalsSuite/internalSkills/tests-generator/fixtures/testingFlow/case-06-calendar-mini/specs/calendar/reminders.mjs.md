# FDS

## Description
Builds reminder objects for calendar events.

## Dependencies
None.

## Main Functions
- buildReminder (event: object, minutesBefore: number) -> object Creates a reminder object for an event.
  Inputs: event object and minutesBefore.
  Outputs: reminder object with id, minutesBefore, title.
  Errors: none.

## Exports
Exports buildReminder as a named function.

## Implementation Details
Derives reminder id from event id and formats title with "Reminder: ".

## Testing
Test buildReminder for correct id, minutesBefore, and title formatting.
