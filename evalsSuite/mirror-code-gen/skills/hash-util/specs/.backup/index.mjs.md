# Specification for index.mjs - Hash Utility

## Module Description
This module implements a cryptographic hash utility for password hashing and verification. It uses the Node.js crypto module to generate SHA-256 hashes with salt and provides verification functionality. The main export is an `action` function that provides access to the hashing functionality.

## Dependencies
- `node:crypto`: Node.js built-in crypto module for cryptographic functions.

---

## Class: HashUtil

### Description
The `HashUtil` class implements the core hashing and verification functionality. It provides methods for generating cryptographic hashes with salt and verifying hashed data.

### Constructor
- Initializes the hash utility (no properties needed).

### Methods

#### generateSalt()
- **Description**: Generates a random salt for hashing.
- **Output**: (string) - Hexadecimal representation of random bytes.
- **Process**:
  1. Generates 16 random bytes using crypto.randomBytes().
  2. Converts the bytes to hexadecimal string.
  3. Returns the salt string.

#### hash(data, salt)
- **Description**: Generates a cryptographic hash of the data with optional salt.
- **Input**:
  - `data` (string): The data to hash.
  - `salt` (string, optional): The salt to use for hashing.
- **Output**: `{ hash: string, salt: string }` - The generated hash and used salt.
- **Process**:
  1. If salt is provided, combines data and salt with a colon separator.
  2. Creates a SHA-256 hash of the (salted) data.
  3. If no salt was provided, generates a new salt.
  4. Returns the hash and the used salt.

#### verify(data, hash, salt)
- **Description**: Verifies if data matches a given hash.
- **Input**:
  - `data` (string): The data to verify.
  - `hash` (string): The hash to verify against.
  - `salt` (string): The salt used in the original hash.
- **Output**: `{ valid: boolean }` - Verification result.
- **Process**:
  1. Computes the hash of the provided data with the given salt.
  2. Compares the computed hash with the provided hash.
  3. Returns true if they match, false otherwise.

---

## Function: action(args)

### Description
The main exported function and the designated entry point for execution. It acts as a dispatcher for the hash utility functionality.

### Input
- `args` (Object):
  - `promptText` (string): Multi-line `key: value` pairs to be parsed using hardcoded regex.

### Prompt Parsing (REQUIRED)
Implement a `parsePromptText(promptText)` helper that extracts values using these exact regexes:

- `operation`: `/^operation\s*:\s*(.+)$/mi`
- `data`: `/^data\s*:\s*(.+)$/mi`
- `salt`: `/^salt\s*:\s*(.+)$/mi`
- `hash`: `/^hash\s*:\s*(.+)$/mi`

Rules:
- Trim extracted values.
- `salt` is optional for `hash` operation.
- `hash` is required for `verify` operation.
- Throw a clear error when a required key is missing.

### Processing Logic
1. Parses `promptText` via `parsePromptText(promptText)`.
2. Validates that required parameters are present.
3. **For `hash` operation**: Calls the `hash` method with the provided data and optional salt.
4. **For `verify` operation**: Validates that hash is provided, then calls the `verify` method.
5. **For unknown operations**: Throws an error indicating the operation is not supported.

### Output
- **hash**: `{ hash: string, salt: string }` - The generated hash and salt.
- **verify**: `{ valid: true }` or `{ valid: false }` - Verification result.

---

## Module Usage

This module exports an `action` function that can be imported and called directly by the CodeSkillsSubsystem.

### Direct Import Usage
```javascript
import { action } from './index.mjs';

// Hash a password
const hashResult = await action({
  promptText: 'operation: hash\ndata: password123\nsalt: customSalt123'
});

console.log('Hash result:', hashResult);

// Verify a password
const verifyResult = await action({
  promptText: 'operation: verify\n' +
    'data: password123\n' +
    `hash: ${hashResult.hash}\n` +
    `salt: ${hashResult.salt}`
});

console.log('Verification result:', verifyResult);

if (verifyResult.valid) {
  console.log('Password is correct!');
} else {
  console.log('Password is incorrect!');
}
```

### Integration with CodeSkillsSubsystem
The CodeSkillsSubsystem will dynamically import this module and call the `action` function directly, eliminating the need for child process communication and improving performance and reliability.
