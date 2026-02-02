# Specification for index.mjs - Schema Validator

## Module Description
This module implements a simple schema validation system for JavaScript objects. It provides functionality to validate object structures against defined schemas with support for basic type checking, string/number constraints, and custom validation rules. The main export is an `action` function that provides access to the validation functionality.

## Dependencies
None (pure JavaScript implementation).

---

## Class: SchemaValidator

### Description
The `SchemaValidator` class implements the core validation functionality. It checks JavaScript objects against defined schemas and collects validation errors.

### Constructor
- Initializes the validator (no properties needed).

### Methods

#### validate(data, schema)
- **Description**: Validates a JavaScript object against a schema.
- **Input**:
  - `data` (object): The data to validate.
  - `schema` (object): The validation schema defining rules for each field.
- **Output**: `{ valid: boolean, errors: array }` - Validation result with errors if any.
- **Process**:
  1. Iterates through each field in the schema.
  2. Checks if required fields are present.
  3. Validates field types (string, number, boolean, etc.).
  4. Applies type-specific validation rules (min/max length for strings, min/max values for numbers, regex patterns).
  5. Collects all validation errors.
  6. Returns validation result with boolean valid flag and error array.

---

## Function: action(args)

### Description
The main exported function and the designated entry point for execution. It acts as a dispatcher for the schema validation functionality.

### Input
- `args` (Object):
  - `promptText` (string): Multi-line `key: value` pairs to be parsed using hardcoded regex.

### Prompt Parsing (REQUIRED)
Implement a `parsePromptText(promptText)` helper that extracts values using these exact regexes:

- `operation`: `/^operation\s*:\s*(.+)$/mi`
- `data`: `/^data\s*:\s*(.+)$/mi`
- `schema`: `/^schema\s*:\s*(.+)$/mi`

Rules:
- Trim extracted values.
- `data` and `schema` must be parsed with `JSON.parse`.
- Throw a clear error when a required key is missing.

### Processing Logic
1. Parses `promptText` via `parsePromptText(promptText)`.
2. Validates that required parameters are present.
3. **For `validate` operation**: Calls the `validate` method with the provided data and schema.
4. **For unknown operations**: Throws an error indicating the operation is not supported.

### Output
- **validate**: `{ valid: true, errors: [] }` for valid data, or `{ valid: false, errors: [...] }` for invalid data.

---

## Module Usage

This module exports an `action` function that can be imported and called directly by the CodeSkillsSubsystem.

### Direct Import Usage
```javascript
import { action } from './index.mjs';

// Define validation schema
const userSchema = {
  name: { type: 'string', required: true, min: 3, max: 50 },
  age: { type: 'number', required: true, min: 18, max: 120 },
  email: { type: 'string', required: true, pattern: '.+@.+\..+' }
};

// Validate user data
const userData = {
  name: 'John Doe',
  age: 25,
  email: 'john@example.com'
};

const validationResult = await action({
  promptText: 'operation: validate\n' +
    'data: {"name":"John Doe","age":25,"email":"john@example.com"}\n' +
    'schema: {"name":{"type":"string","required":true,"min":3,"max":50},"age":{"type":"number","required":true,"min":18,"max":120},"email":{"type":"string","required":true,"pattern":".+@.+\\..+"}}'
});

if (validationResult.valid) {
  console.log('Validation passed!');
} else {
  console.log('Validation failed:');
  validationResult.errors.forEach(error => {
    console.log(`- ${error.field}: ${error.message}`);
  });
}
```

### Integration with CodeSkillsSubsystem
The CodeSkillsSubsystem will dynamically import this module and call the `action` function directly, eliminating the need for child process communication and improving performance and reliability.
