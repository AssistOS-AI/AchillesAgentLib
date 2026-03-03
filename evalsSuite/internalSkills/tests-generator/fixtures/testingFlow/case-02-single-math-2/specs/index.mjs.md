# FDS

## Description
Provides basic numeric utilities for clamping values, computing median, and computing variance. This is a small math helper module without external dependencies.

## Dependencies
None.

## Main Functions
- clamp (value: number, min: number, max: number) -> number Clamps a value to the inclusive [min, max] range.
  Inputs: value and bounds.
  Outputs: clamped value.
  Errors: none.
- median (values: number[]) -> number | null Computes the median of a numeric array.
  Inputs: array of numbers.
  Outputs: median value; returns null for empty arrays.
  Errors: none.
- variance (values: number[]) -> number Computes population variance for a numeric array.
  Inputs: array of numbers.
  Outputs: variance; returns 0 for empty arrays.
  Errors: none.

## Exports
Exports clamp, median, and variance as named functions for direct use by callers.

## Implementation Details
Uses Math.min/Math.max for clamp, sorts a copy for median, and calculates average + squared deltas for variance. No external libraries.

## Testing
Test clamp within bounds, below min, and above max. Test median for odd length, even length, and empty array (null). Test variance for empty array (0), simple values with known variance, and array with identical values (0 variance).
