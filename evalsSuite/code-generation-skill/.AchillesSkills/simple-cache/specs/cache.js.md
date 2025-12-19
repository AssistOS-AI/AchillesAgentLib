# Specification for cache.js - Cache API Component

## Module Description
This module implements the public API for the Simple Cache system. It provides a user-friendly interface for cache operations and coordinates the underlying storage and expiration components.

## Dependencies
- `./store.js`: Cache storage functionality
- `./expiration.js`: Expiration checking utilities

---

## Class: SimpleCache

### Description
The `SimpleCache` class provides the main API for cache operations. It acts as a facade that simplifies cache usage and handles the coordination between storage and expiration components.

### Constructor
- Initializes the cache system
- Sets up the storage and expiration components
- Creates a new instance of the cache

### Properties
- `store`: Instance of the storage component
- `expiration`: Instance of the expiration utilities

### Methods

#### set(key, value, ttl)
- **Description**: Stores a value in the cache with optional TTL
- **Input**:
  - `key` (string): The cache key
  - `value` (any): The value to store
  - `ttl` (number, optional): Time-to-live in milliseconds
- **Output**: `{ success: true, key: string }` - Confirmation object
- **Process**:
  1. Validates input parameters
  2. Calculates expiration timestamp if TTL is provided
  3. Creates cache entry with value and expiration
  4. Stores entry using the storage component
  5. Returns success confirmation

#### get(key)
- **Description**: Retrieves a value from the cache
- **Input**: `key` (string): The cache key
- **Output**: The stored value or `null` if not found/expired
- **Process**:
  1. Retrieves the cache entry using storage component
  2. Checks if entry exists and is not expired
  3. Returns the value or `null` if invalid/expired

#### has(key)
- **Description**: Checks if a key exists in the cache and is not expired
- **Input**: `key` (string): The cache key
- **Output**: `true` or `false`
- **Process**:
  1. Uses storage component to check key existence
  2. Uses expiration utilities to check if entry is expired
  3. Returns combined result

#### delete(key)
- **Description**: Removes a key from the cache
- **Input**: `key` (string): The cache key
- **Output**: `{ success: true, deleted: boolean }` - Confirmation object
- **Process**:
  1. Checks if key exists using storage component
  2. Removes the key if it exists
  3. Returns confirmation with deletion status

#### clear()
- **Description**: Clears all entries from the cache
- **Output**: `{ success: true, cleared: number }` - Confirmation with count of cleared entries
- **Process**:
  1. Gets current cache size
  2. Clears all entries using storage component
  3. Returns confirmation with count

#### getStats()
- **Description**: Returns statistics about the cache
- **Output**: `{ size: number, keys: string[] }` - Cache statistics
- **Process**:
  1. Gets current cache size and keys from storage
  2. Returns statistics object

---

## Integration
This module provides the main API that will be used by the `index.js` component. It abstracts the underlying storage and expiration details, providing a clean interface for cache operations.

## Usage Example
```javascript
const cache = new SimpleCache();

// Store a value with 5-second TTL
cache.set('user:123', { name: 'John', age: 25 }, 5000);

// Retrieve the value
const user = cache.get('user:123');
console.log(user); // { name: 'John', age: 25 }

// Check if key exists
const exists = cache.has('user:123');
console.log(exists); // true

// Delete the key
cache.delete('user:123');

// Get cache statistics
const stats = cache.getStats();
console.log(stats);
```
