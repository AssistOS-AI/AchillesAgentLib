# Schema Validator

Validates JavaScript objects against defined schemas.

## Summary
This skill implements a simple schema validation system that checks if JavaScript objects conform to specified structures. It supports basic type validation, minimum/maximum constraints, and custom validation rules. All operations are exposed through a single, dynamic entry point.

## Input Format
The skill is invoked via an `action` function that accepts an object with a `promptText` string. The `promptText` must use `key: value` pairs, one per line.

- **promptText** (string): Multi-line text containing `key: value` pairs.
  - `operation` (string, mandatory): `validate`.
  - `data` (object, mandatory): JSON string for the data object.
  - `schema` (object, mandatory): JSON string for the schema object.

## Output Format
- **Type**: `object`
- **Description**: The output depends on the operation invoked.
- **Success Examples**:
  - **validate**: Returns `{ valid: true, errors: [] }` for valid data, or `{ valid: false, errors: [...] }` for invalid data.
- **Error Example**: An error is thrown if required parameters are missing.

## Constraints
- Schema must define validation rules for each field.
- Supported validation types: string, number, boolean, object, array.
- Validation rules must be properly formatted.
