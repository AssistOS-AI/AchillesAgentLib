# FDS

## Description
Provides a simple in-memory storage for records keyed by table name, with put, list, and clear operations.

## Dependencies
None.

## Main Functions
- put (table: string, record: object) -> void Inserts a record into the table store.
  Inputs: table name, record object.
  Outputs: none.
  Errors: none.
- list (table: string) -> object[] Returns all stored records for a table.
  Inputs: table name.
  Outputs: array of stored records.
  Errors: none.
- clear (table: string) -> void Clears all records for a table.
  Inputs: table name.
  Outputs: none.
  Errors: none.

## Exports
Exports put, list, and clear as named functions.

## Implementation Details
Uses a module-scoped Map of table -> record array. Clones records on insert and returns new arrays on list.

## Testing
Test that put inserts records, list returns copies, and clear resets a table. Verify tables are isolated.
