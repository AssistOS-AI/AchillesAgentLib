# FDS

## Description
Implements a simple order adapter that maps incoming records and stores them in an in-memory table. Provides save, list, and reset operations for orders.

## Dependencies
- src/db/store.mjs - put : Persists a mapped order record in storage.
- src/db/store.mjs - list : Reads stored orders for listOrders.
- src/db/store.mjs - clear : Clears the orders table on reset.
- src/db/mapper.mjs - mapRecord : Normalizes incoming order records before storage.

## Main Functions
- saveOrder (order: object) -> object Maps and stores an order record.
  Inputs: order record.
  Outputs: mapped record.
  Errors: none.
- listOrders () -> object[] Returns all stored orders.
  Inputs: none.
  Outputs: array of order records.
  Errors: none.
- resetOrders () -> void Clears all stored orders.
  Inputs: none.
  Outputs: none.
  Errors: none.

## Exports
Exports saveOrder, listOrders, and resetOrders as named functions.

## Implementation Details
Uses mapRecord to normalize inputs and an in-memory store keyed by table name. No external dependencies.

## Testing
Test saveOrder returns mapped record and persists to listOrders. Test listOrders after multiple saves. Test resetOrders clears storage.
