# Specification for index.mjs - Config Loader with Type Validation

## Module Description
This module implements a configuration loader that reads settings from environment variables or objects and validates them against a type schema. It supports automatic type conversion (string to number/boolean/JSON) and provides detailed error reporting. The main export is an `action` function that provides access to the configuration loading functionality.

## Dependencies
None (pure JavaScript implementation).

---

## Class: ConfigLoader

### Description
The `ConfigLoader` class implements the core configuration loading and type validation functionality. It reads configuration values, converts them to the specified types, and collects any conversion errors.

### Constructor
- Initializes the config loader (no properties needed).

### Methods

#### load(source, schema)
- **Description**: Loads and validates configuration from a source.
- **Input**:
  - `source` (object): The configuration source (e.g., process.env or custom object).
  - `schema` (object): The type validation schema (key: type mapping).
- **Output**: `{ success: boolean, config: object, errors: array }` - Load result with converted config and errors.
- **Process**:
  1. Iterates through each key in the schema.
  2. Retrieves the value from the source.
  3. If value is missing, adds an error and continues.
  4. Converts the value to the specified type:
     - `string`: Converts to string using String() constructor.
     - `number`: Converts to number using Number() constructor, validates it's not NaN.
     - `boolean`: Converts 'true' string or true boolean to true, others to false.
     - `json`: Parses the string as JSON.
  5. Collects any conversion errors.
  6. Returns the converted configuration and any errors encountered.

---

## Function: action(args)

### Description
The main exported function and the designated entry point for execution. It acts as a dispatcher for the configuration loading functionality.

### Input
- `args` (Object):
  - `promptText` (string): Multi-line `key: value` pairs to be parsed using hardcoded regex.

### Prompt Parsing (REQUIRED)
Implement a `parsePromptText(promptText)` helper that extracts values using these exact regexes:

- `operation`: `/^operation\s*:\s*(.+)$/mi`
- `source`: `/^source\s*:\s*(.+)$/mi`
- `schema`: `/^schema\s*:\s*(.+)$/mi`

Rules:
- Trim extracted values.
- `source` and `schema` must be parsed with `JSON.parse`.
- Throw a clear error when a required key is missing.

### Processing Logic
1. Parses `promptText` via `parsePromptText(promptText)`.
2. Validates that required parameters are present.
3. **For `load` operation**: Calls the `load` method with the provided source and schema.
4. **For unknown operations**: Throws an error indicating the operation is not supported.

### Output
- **load**: `{ success: true, config: object, errors: [] }` for valid config, or `{ success: false, config: object, errors: [...] }` for invalid config.

---

## Module Usage

This module exports an `action` function that can be imported and called directly by the CodeSkillsSubsystem.

### Direct Import Usage
```javascript
import { action } from './index.mjs';

// Define configuration schema
const configSchema = {
  DB_HOST: 'string',
  DB_PORT: 'number',
  DEBUG: 'boolean',
  FEATURES: 'json'
};

// Simulate environment variables
const configSource = {
  DB_HOST: 'localhost',
  DB_PORT: '5432',
  DEBUG: 'true',
  FEATURES: '{"cache":true,"logging":false}'
};

// Load and validate configuration
const loadResult = await action({
  promptText: 'operation: load\n' +
    'source: {"DB_HOST":"localhost","DB_PORT":"5432","DEBUG":"true","FEATURES":"{\\"cache\\":true,\\"logging\\":false}"}\n' +
    'schema: {"DB_HOST":"string","DB_PORT":"number","DEBUG":"boolean","FEATURES":"json"}'
});

if (loadResult.success) {
  console.log('Configuration loaded successfully:');
  console.log(loadResult.config);
} else {
  console.log('Configuration loading failed:');
  loadResult.errors.forEach(error => {
    console.log(`- ${error.key}: ${error.message}`);
  });
}
```

### Integration with CodeSkillsSubsystem
The CodeSkillsSubsystem will dynamically import this module and call the `action` function directly, eliminating the need for child process communication and improving performance and reliability.
