# FDS

## Description
Filters duplicate links while preserving first-seen order.

## Dependencies
None.

## Main Functions
- filterUnique (links: string[]) -> string[] Removes duplicate links.
  Inputs: list of links.
  Outputs: list of unique links in original order.
  Errors: none.

## Exports
Exports filterUnique as a named function.

## Implementation Details
Uses a Set to track seen values and builds an output array in order.

## Testing
Test with duplicate links, already unique links, and empty arrays.
