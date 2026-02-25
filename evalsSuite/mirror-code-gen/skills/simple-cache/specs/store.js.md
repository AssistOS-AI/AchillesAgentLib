# Specification for store.js - Cache Storage Component

## Module Description
This module implements the core storage functionality for the Simple Cache system. It manages the in-memory storage of cache entries using a Map data structure.

## Dependencies
None (pure JavaScript implementation using Map).

---

## Class: CacheStore

### Description
The `CacheStore` class provides the fundamental storage operations for the cache system. It handles the low-level storage and retrieval of cache entries.

### Constructor
- Initializes an empty Map to store cache entries
- Sets up the data structure for key-value storage

### Properties
- `store`: Map instance that holds the cache entries

### Methods

#### set(key, value, ttl)
- **Description**: Stores a value in the cache with optional TTL
- **Input**:
  - `key` (string): The cache key
  - `value` (any): The value to store
  - `ttl` (number, optional): Time-to-live in milliseconds
- **Output**: `{ success: true, key: string }` - Confirmation object
- **Process**:
  1. Creates a cache entry with value and optional expiration timestamp
  2. Stores the entry in the Map
  3. Returns success confirmation

#### get(key)
- **Description**: Retrieves a value from the cache
- **Input**: `key` (string): The cache key
- **Output**: The stored value or `null` if not found/expired
- **Process**:
  1. Retrieves the cache entry
  2. If entry doesn't exist, returns `null`
  3. If entry exists but is expired, removes it and returns `null`
  4. If entry exists and is valid, returns the stored value

#### has(key)
- **Description**: Checks if a key exists in the cache and is not expired
- **Input**: `key` (string): The cache key
- **Output**: `true` or `false`
- **Process**:
  1. Retrieves the cache entry
  2. If entry doesn't exist, returns `false`
  3. If entry exists but is expired, removes it and returns `false`
  4. If entry exists and is valid, returns `true`

#### delete(key)
- **Description**: Removes a key from the cache
- **Input**: `key` (string): The cache key
- **Output**: `{ success: true, deleted: boolean }` - Confirmation object
- **Process**:
  1. Checks if the key exists
  2. Removes the key from the Map
  3. Returns confirmation indicating whether the key existed

---

## Cache Entry Structure
Each cache entry is stored as an object with the following structure:
```javascript
{
  value: any,          // The cached value
  expires: number|null // Expiration timestamp (null if no TTL)
}
```

---

## Integration
This module is used by the main `cache.js` component to provide the underlying storage functionality for the Simple Cache skill.
