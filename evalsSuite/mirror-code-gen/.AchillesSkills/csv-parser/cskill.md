# CSV Parser and Transformer

Parses CSV strings and transforms data according to specified rules.

## Summary
This skill provides a unified interface for parsing CSV data from strings and applying transformations. It allows for converting CSV strings to JSON arrays, filtering data based on conditions, and mapping field names. All operations are exposed through a single, dynamic entry point.

## Input Format
The skill is invoked via an `action` function that accepts an object with a `promptText` string. The `promptText` must use `key: value` pairs, one per line.

- **promptText** (string): Multi-line text containing `key: value` pairs.
  - `operation` (string, mandatory): `parse`, `transform`, or `parseAndTransform`.
  - `csvString` (string, mandatory): CSV data as a single line with escaped newlines (use `\n`).
  - `transformConfig` (object, optional): JSON object as a single-line string. Example: `{"fieldMappings":{"name":"fullName"},"filters":{"userAge":{"gt":25}}}`.

## Output Format
- **Type**: `object`
- **Description**: The output depends on the operation invoked.
- **Success Examples**:
  - **parse**: Returns `{ parsedData: [{...}, {...}] }` - array of parsed objects.
  - **transform**: Returns `{ transformedData: [{...}, {...}] }` - array of transformed objects.
  - **parseAndTransform**: Returns `{ parsedData: [...], transformedData: [...] }`.
- **Error Example**: An error is thrown if the CSV string is invalid or if transformation configuration is malformed.

## Constraints
- The `csvString` must be valid CSV format.
- The `operation` must be one of the supported values.
- Transformation configuration must match the structure of the parsed data.
