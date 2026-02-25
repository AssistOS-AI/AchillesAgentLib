# Specification for expiration.js - Cache Expiration Component

## Module Description
This module implements the expiration checking functionality for the Simple Cache system. It provides utilities for checking and managing the time-to-live (TTL) aspects of cache entries.

## Dependencies
None (pure JavaScript implementation).

---

## Function: isExpired(entry)

### Description
Checks if a cache entry has expired based on its expiration timestamp.

### Input
- `entry` (object): The cache entry to check
  - `entry.expires` (number|null): The expiration timestamp

### Output
- Returns `true` if the entry has expired, `false` otherwise

### Processing Logic
1. **Check for Expiration**: If `entry.expires` is `null` or undefined, the entry never expires
2. **Compare Timestamps**: If expiration timestamp exists, compare it with current time
3. **Return Result**: Returns `true` if current time > expiration time, `false` otherwise

### Example
```javascript
const entry1 = { value: 'data', expires: null };
const entry2 = { value: 'data', expires: Date.now() - 1000 }; // Expired 1 second ago
const entry3 = { value: 'data', expires: Date.now() + 10000 }; // Expires in 10 seconds

console.log(isExpired(entry1)); // false (no expiration)
console.log(isExpired(entry2)); // true (expired)
console.log(isExpired(entry3)); // false (not yet expired)
```

---

## Function: calculateExpiration(ttl)

### Description
Calculates the expiration timestamp based on a time-to-live value.

### Input
- `ttl` (number|null): Time-to-live in milliseconds, or `null` for no expiration

### Output
- Returns the expiration timestamp (number) or `null` if no TTL

### Processing Logic
1. **Check for TTL**: If `ttl` is `null`, `undefined`, or not a positive number, return `null`
2. **Calculate Timestamp**: If valid TTL, return `Date.now() + ttl`

### Example
```javascript
console.log(calculateExpiration(null)); // null
console.log(calculateExpiration(5000)); // Current timestamp + 5000ms
console.log(calculateExpiration(0)); // null (invalid)
```

---

## Function: getRemainingTime(entry)

### Description
Calculates the remaining time until a cache entry expires.

### Input
- `entry` (object): The cache entry
  - `entry.expires` (number|null): The expiration timestamp

### Output
- Returns the remaining time in milliseconds, or `null` if no expiration

### Processing Logic
1. **Check for Expiration**: If `entry.expires` is `null`, return `null`
2. **Calculate Remaining**: If expiration exists, return `entry.expires - Date.now()`
3. **Handle Negative**: If result is negative, return `0` (already expired)

### Example
```javascript
const entry = { value: 'data', expires: Date.now() + 5000 };
console.log(getRemainingTime(entry)); // ~5000 (remaining milliseconds)
```

---

## Integration
This module is used by the main `cache.js` component to handle expiration checking and management for cache entries. The functions provide the necessary utilities to determine when cache entries should be considered expired and removed from the cache.
