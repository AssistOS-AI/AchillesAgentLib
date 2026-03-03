# FDS

## Description
Provides basic math helpers for summing ranges, computing factorials, and calculating arithmetic mean. This is a small utility module for numeric operations and does not handle validation beyond the documented edge cases.

## Dependencies
None.

## Main Functions
- sumRange (start: number, end: number) -> number Sums all integers from start to end, inclusive.
  Inputs: start and end numbers.
  Outputs: total sum; returns 0 when start > end due to loop condition.
  Errors: none.
- factorial (value: number) -> number Computes factorial for non-negative integers.
  Inputs: value; must be >= 0.
  Outputs: factorial; returns 1 for value 0.
  Errors: throws when value is negative.
- mean (values: number[]) -> number Computes arithmetic mean for a list of numbers.
  Inputs: array of numbers.
  Outputs: average; returns 0 for empty arrays.
  Errors: none.

## Exports
Exports sumRange, factorial, and mean as named functions for direct consumption by callers.

## Implementation Details
Uses simple for-loops and Array.reduce. No external dependencies. Error handling is limited to factorial input validation.

## Testing
Test sumRange for normal ranges (1..3), zero-length ranges (5..5), and start > end. Test factorial for 0, 1, and a larger value; assert error on negative input. Test mean with empty array, single value, and multiple values.
