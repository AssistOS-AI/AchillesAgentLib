# FDS

## Description
Stores events in memory and provides add, list, and clear operations.

## Dependencies
None.

## Main Functions
- addEvent (event: object) -> void Adds an event copy to storage.
  Inputs: event object.
  Outputs: none.
  Errors: none.
- listEvents () -> object[] Returns stored events as a new array.
  Inputs: none.
  Outputs: array of events.
  Errors: none.
- clearEvents () -> void Clears all stored events.
  Inputs: none.
  Outputs: none.
  Errors: none.

## Exports
Exports addEvent, listEvents, and clearEvents as named functions.

## Implementation Details
Uses a module-scoped array. addEvent clones input. listEvents returns a copy.

## Testing
Test addEvent and listEvents with multiple entries. Test clearEvents empties storage.
