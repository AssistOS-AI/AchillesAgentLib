# FDS

## Description
Provides query builder helpers that wrap table names and records into simple objects for insert and select-all operations.

## Dependencies
None.

## Main Functions
- buildInsert (table: string, record: object) -> { table: string, record: object } Builds an insert query payload.
  Inputs: table name and record.
  Outputs: object containing table and record.
  Errors: none.
- buildSelectAll (table: string) -> { table: string } Builds a select-all query payload.
  Inputs: table name.
  Outputs: object containing table.
  Errors: none.

## Exports
Exports buildInsert and buildSelectAll as named functions.

## Implementation Details
Pure functions that return new objects. No external dependencies.

## Testing
Test that buildInsert returns the expected object and that buildSelectAll returns the correct table name.
