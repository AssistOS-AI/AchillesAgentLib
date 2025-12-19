# Simple Template Engine

Replaces placeholders in strings with values from data objects.

## Summary
This skill implements a simple template engine that replaces placeholders in strings with values from data objects. It supports nested object access and basic template syntax. All operations are exposed through a single, dynamic entry point.

## Input Format
The skill is invoked via an `action` function that accepts a single object specifying the operation to be performed.

- **args** (Object): The container for the command.
  - `operation` (string, mandatory): The operation to perform. Currently only `render` is supported.
  - `template` (string, mandatory): The template string with placeholders.
  - `data` (object, mandatory): The data object containing values for placeholders.

## Output Format
- **Type**: `string`
- **Description**: The output depends on the operation invoked.
- **Success Examples**:
  - **render**: Returns the rendered string with placeholders replaced by actual values.
- **Error Example**: An error is thrown if required parameters are missing.

## Constraints
- Template must use `{key}` or `{nested.key}` syntax for placeholders.
- Data object must contain all required keys.
- Nested keys are accessed using dot notation.
