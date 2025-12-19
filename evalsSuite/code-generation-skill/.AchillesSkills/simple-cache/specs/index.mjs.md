# Specification for index.mjs - Simple In-Memory Cache with TTL

## Module Description
This module implements a simple in-memory cache system with time-to-live (TTL) functionality. It provides methods for storing key-value pairs, retrieving values, checking key existence, and deleting entries. The main export is an `action` function that dynamically dispatches calls to the appropriate cache methods.

## Dependencies
None (pure JavaScript implementation using Map).

---

## Class: SimpleCache

### Description
The `SimpleCache` class implements the core caching functionality with TTL support. It uses a Map to store cache entries and handles automatic expiration of entries.

### Constructor
- Initializes an empty Map to store cache entries.

### Methods

#### set(key, value, ttl)
- **Description**: Stores a value in the cache with an optional TTL.
- **Input**:
  - `key` (string): The cache key.
  - `value` (any): The value to store.
  - `ttl` (number, optional): Time-to-live in milliseconds.
- **Output**: `{ success: true, key: '...' }` - Confirmation object.
- **Process**:
  1. Creates a cache entry with the value and optional expiration timestamp.
  2. Stores the entry in the Map.
  3. Returns a success confirmation.

#### get(key)
- **Description**: Retrieves a value from the cache.
- **Input**: `key` (string): The cache key.
- **Output**: The stored value or `null` if not found/expired.
- **Process**:
  1. Retrieves the cache entry.
  2. If entry doesn't exist, returns `null`.
  3. If entry exists but is expired, removes it and returns `null`.
  4. If entry exists and is valid, returns the stored value.

#### has(key)
- **Description**: Checks if a key exists in the cache and is not expired.
- **Input**: `key` (string): The cache key.
- **Output**: BOOLEAN VALUE ONLY - `true` or `false` (NOT an object, just the boolean primitive).
- **Process**:
  1. Retrieves the cache entry.
  2. If entry doesn't exist, returns `false`.
  3. If entry exists but is expired, removes it and returns `false`.
  4. If entry exists and is valid, returns `true`.
- **CRITICAL**: This method MUST return a raw boolean value (`true` or `false`), NOT an object like `{ success: true }` or `{ result: true }`.

#### delete(key)
- **Description**: Removes a key from the cache.
- **Input**: `key` (string): The cache key.
- **Output**: `{ success: true, deleted: true/false }` - Confirmation object.
- **Process**:
  1. Checks if the key exists.
  2. Removes the key from the Map.
  3. Returns a confirmation indicating whether the key existed.

---

## Function: action(args)

### Description
The main exported function and the designated entry point for execution. It acts as a dynamic dispatcher, invoking the appropriate method on the SimpleCache instance based on runtime arguments.

### Input
- `args` (Object):
  - `operation` (string): The operation to perform. Can be `set`, `get`, `has`, or `delete`.
  - `key` (string): The cache key.
  - `value` (any, optional): The value to store (required for set operation).
  - `ttl` (number, optional): Time-to-live in milliseconds (for set operation).

### Processing Logic
1. Destructures `operation`, `key`, `value`, and `ttl` from the `args` object.
2. Validates that required parameters are present.
3. **For `set` operation**: Validates that value is provided, then calls the `set` method.
4. **For `get` operation**: Calls the `get` method and returns the result.
5. **For `has` operation**: Calls the `has` method and returns the result.
6. **For `delete` operation**: Calls the `delete` method and returns the result.
7. **For unknown operations**: Throws an error indicating the operation is not supported.

### Output
- **set**: `{ success: true, key: '...' }` - Confirmation of successful storage.
- **get**: The stored value or `null` if not found/expired.
- **has**: BOOLEAN ONLY - `true` or `false` indicating key existence. DO NOT wrap in an object.
- **delete**: `{ success: true, deleted: true/false }` - Confirmation of deletion.

### CRITICAL IMPLEMENTATION NOTES - READ CAREFULLY
**The `action` function MUST handle return values correctly for each operation:**

✅ CORRECT - `has` returns boolean directly:
```javascript
case 'has':
  const exists = cache.has(key);
  return exists;  // Direct boolean return (true or false)
```

✅ CORRECT - `get` returns the value directly:
```javascript
case 'get':
  const value = cache.get(key);
  return value;  // Direct value return (could be any type, or null)
```

❌ WRONG - Do NOT wrap `has` in an object:
```javascript
case 'has':
  const exists = cache.has(key);
  return { result: exists };  // WRONG! Do not do this!
  return { exists: exists };  // WRONG! Do not do this!
  return { success: exists }; // WRONG! Do not do this!
```

**IMPORTANT**:
- The `has` operation returns a boolean primitive directly (`true` or `false`)
- The `get` operation returns the stored value directly (any type, or `null`)
- Only `set` and `delete` operations return object wrappers with metadata

---

## Module Usage

This module exports an `action` function that can be imported and called directly by the CodeSkillsSubsystem.

### Direct Import Usage
```javascript
import { action } from './index.mjs';

// Set a cache value with TTL
const setResult = await action({
  operation: 'set',
  key: 'user_data',
  value: { name: 'John', age: 25 },
  ttl: 5000 // 5 seconds
});

console.log('Set result:', setResult);

// Get a cache value
const getResult = await action({
  operation: 'get',
  key: 'user_data'
});

console.log('Get result:', getResult);

// Check if key exists
const hasResult = await action({
  operation: 'has',
  key: 'user_data'
});

console.log('Has result:', hasResult);
```

### Integration with CodeSkillsSubsystem
The CodeSkillsSubsystem will dynamically import this module and call the `action` function directly, eliminating the need for child process communication and improving performance and reliability.
