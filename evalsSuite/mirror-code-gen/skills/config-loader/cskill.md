# Config Loader with Type Validation

Loads and validates configuration from environment variables or objects.

## Description
This skill implements a configuration loader that reads settings from environment variables or objects and validates them against a type schema. It supports automatic type conversion and validation. All operations are exposed through a single, dynamic entry point.

## Input Format
The skill is invoked via an `action` function that accepts an object with a `promptText` string. The `promptText` must use `key: value` pairs, one per line.

- **promptText** (string): Multi-line text containing `key: value` pairs.
  - `operation` (string, mandatory): `load`.
  - `source` (object, mandatory): JSON string for the source object.
  - `schema` (object, mandatory): JSON string for the schema object.

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
