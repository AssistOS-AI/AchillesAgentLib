# CSV Parser and Transformer

Parses CSV strings and transforms data according to specified rules.

## Summary
This skill provides a unified interface for parsing CSV data from strings and applying transformations. It allows for converting CSV strings to JSON arrays, filtering data based on conditions, and mapping field names. All operations are exposed through a single, dynamic entry point.

## Input Format
The skill is invoked via an `action` function that accepts a single object specifying the operation to be performed.

- **args** (Object): The container for the command.
  - `operation` (string, mandatory): The operation to perform. Can be `parse`, `transform`, or `parseAndTransform`.
  - `csvString` (string, mandatory): The CSV data as a string.
  - `transformConfig` (object, optional): Configuration for transformation operations.
    - `fieldMappings` (object): Mapping of field names (e.g., { name: "fullName", age: "userAge" }).
    - `filters` (object): Filter conditions (e.g., { userAge: { gt: 25 } }).

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
