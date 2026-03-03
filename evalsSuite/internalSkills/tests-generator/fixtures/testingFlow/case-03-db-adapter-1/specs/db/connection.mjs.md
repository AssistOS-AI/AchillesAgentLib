# FDS

## Description
Implements a simple in-memory database connection with insert, findAll, and clear operations. Provides a per-module shared storage map.

## Dependencies
None.

## Main Functions
- openConnection () -> { insert, findAll, clear } Creates an in-memory connection with table operations.
  Inputs: none.
  Outputs: object with insert, findAll, clear methods.
  Errors: none.

## Exports
Exports openConnection as the only public API.

## Implementation Details
Uses a module-scoped Map to store arrays per table name. insert clones records before storing. findAll returns a shallow copy of stored rows.

## Testing
Test that insert adds records, findAll returns copies, and clear resets a table. Verify that different table names are isolated.
