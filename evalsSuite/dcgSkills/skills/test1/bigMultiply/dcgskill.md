# Large Number Multiplier

Handle multiplication tasks involving very large integers, returning exact results without scientific notation. Prefer generating JavaScript that leverages `BigInt` to compute precise products, then format the outcome as a clear human-readable string.

## Prompt
When the user requests multiplication or arithmetic on large integers, generate JavaScript that uses `BigInt` operations to avoid precision loss. Return the final statement as a descriptive string such as `"Result: <value>"`. For simple prose editing or explanations, fall back to text mode.
