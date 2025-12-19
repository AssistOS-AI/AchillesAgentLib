# Specification for index.mjs - Simple Template Engine

## Module Description
This module implements a simple template engine that replaces placeholders in strings with values from data objects. It supports basic placeholder syntax and nested object access using dot notation. The main export is an `action` function that provides access to the template rendering functionality.

## Dependencies
None (pure JavaScript implementation using regex).

---

## Class: TemplateEngine

### Description
The `TemplateEngine` class implements the core template rendering functionality. It parses template strings, extracts placeholders, and replaces them with corresponding values from the data object.

### Constructor
- Initializes the template engine (no properties needed).

### Methods

#### render(template, data)
- **Description**: Renders a template string by replacing placeholders with data values.
- **Input**:
  - `template` (string): The template string containing placeholders in `{key}` format.
  - `data` (object): The data object containing values for the placeholders.
- **Output**: STRING VALUE ONLY - The rendered string with placeholders replaced (NOT an object, just the string primitive).
- **Process**:
  1. Uses regex to find all placeholders in the format `{key}` or `{nested.key}`.
  2. For each placeholder:
     - Splits the key by dots to handle nested access.
     - Traverses the data object following the key path.
     - If the value is found, converts it to string and replaces the placeholder.
     - If the value is not found, leaves the original placeholder unchanged.
  3. Returns the fully rendered string.
- **CRITICAL**: This method MUST return a raw string value, NOT an object like `{ result: "..." }` or `{ rendered: "..." }`.

---

## Function: action(args)

### Description
The main exported function and the designated entry point for execution. It acts as a dispatcher for the template engine functionality.

### Input
- `args` (Object):
  - `operation` (string): The operation to perform (currently only 'render' is supported).
  - `template` (string): The template string to render.
  - `data` (object): The data object for placeholder values.

### Processing Logic
1. Destructures `operation`, `template`, and `data` from the `args` object.
2. Validates that required parameters are present.
3. **For `render` operation**: Calls the `render` method with the provided template and data.
4. **For unknown operations**: Throws an error indicating the operation is not supported.

### Output
- **render**: STRING ONLY - The rendered template with placeholders replaced by actual values. DO NOT wrap in an object.

### CRITICAL IMPLEMENTATION NOTES - READ CAREFULLY
**The `action` function for the `render` operation MUST return the string directly:**

✅ CORRECT - Return the string directly:
```javascript
case 'render':
  const rendered = templateEngine.render(template, data);
  return rendered;  // Direct string return
```

❌ WRONG - Do NOT wrap in an object:
```javascript
case 'render':
  const rendered = templateEngine.render(template, data);
  return { result: rendered };  // WRONG! Do not do this!
  return { rendered: rendered }; // WRONG! Do not do this!
  return { data: rendered };     // WRONG! Do not do this!
```

**IMPORTANT**: When the operation is 'render', the action function must return EXACTLY what the render() method returns, which is a string. Do not add any wrapper object.

---

## Module Usage

This module exports an `action` function that can be imported and called directly by the CodeSkillsSubsystem.

### Direct Import Usage
```javascript
import { action } from './index.mjs';

// Define template with placeholders
const template = "Hello {user.name}! Your age is {user.age} and you live in {user.address.city}.";

// Define data object
const data = {
  user: {
    name: 'John Doe',
    age: 30,
    address: {
      city: 'New York',
      country: 'USA'
    }
  }
};

// Render the template
const rendered = await action({
  operation: 'render',
  template: template,
  data: data
});

console.log('Rendered template:', rendered);
// Output: "Hello John Doe! Your age is 30 and you live in New York."
```

### Integration with CodeSkillsSubsystem
The CodeSkillsSubsystem will dynamically import this module and call the `action` function directly, eliminating the need for child process communication and improving performance and reliability.
