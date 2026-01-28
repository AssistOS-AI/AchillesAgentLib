# Config Loader with Type Validation

Loads and validates configuration from environment variables or objects.

## Summary
This skill implements a configuration loader that reads settings from environment variables or objects and validates them against a type schema. It supports automatic type conversion and validation. All operations are exposed through a single, dynamic entry point.

## Input Format
The skill is invoked via an `action` function that accepts a single object specifying the operation to be performed.

- **args** (Object): The container for the command.
  - `operation` (string, mandatory): The operation to perform. Currently only `load` is supported.
  - `source` (object, mandatory): The configuration source (environment variables or object).
  - `schema` (object, mandatory): The type validation schema.

## Output Format
- **Type**: `object`
- **Description**: The output depends on the operation invoked.
- **Success Examples**:
  - **load**: Returns `{ success: true, config: object, errors: [] }` for valid config, or `{ success: false, config: object, errors: [...] }` for invalid config.
- **Error Example**: An error is thrown if required parameters are missing.

## Constraints
- Source must contain the configuration values.
- Schema must define types for each configuration key.
- Supported types: string, number, boolean, json.
