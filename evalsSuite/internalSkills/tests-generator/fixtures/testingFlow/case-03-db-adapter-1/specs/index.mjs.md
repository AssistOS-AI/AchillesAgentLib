# FDS

## Description
Defines a user adapter class that wraps a simple in-memory connection and query builders to add, list, and reset users. Acts as the public facade for user storage.

## Dependencies
- src/db/connection.mjs - openConnection : Creates the in-memory connection used by the adapter.
- src/db/queries.mjs - buildInsert : Builds insert query objects for addUser.
- src/db/queries.mjs - buildSelectAll : Builds select query objects for listUsers.

## Main Functions
- constructor () -> UserAdapter Initializes a new adapter with an open connection.
  Inputs: none.
  Outputs: instance with active connection.
  Errors: none.
- addUser (user: object) -> object Adds a user record to the users table.
  Inputs: user record object.
  Outputs: the record inserted.
  Errors: none.
- listUsers () -> object[] Returns all user records from the users table.
  Inputs: none.
  Outputs: array of user records (copies).
  Errors: none.
- reset () -> void Clears all users from the table.
  Inputs: none.
  Outputs: none.
  Errors: none.

## Exports
Exports UserAdapter class as the module public API.

## Implementation Details
Uses the in-memory connection object returned by openConnection. Query builders are simple data wrappers. No external dependencies.

## Testing
Test that addUser inserts and returns the record, listUsers returns inserted records, and reset clears the users table. Include a flow that adds multiple users then lists them.
