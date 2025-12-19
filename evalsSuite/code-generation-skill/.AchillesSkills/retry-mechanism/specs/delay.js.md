# Specification for delay.js - Delay Calculation Component

## Module Description
This module implements the delay calculation functionality for exponential backoff in the retry mechanism.

## Dependencies
None (pure JavaScript implementation).

---

## Function: calculateDelay(attempt, baseDelay)

### Description
Calculates the delay time for a retry attempt using exponential backoff.

### Input
- `attempt` (number): The current attempt number (1-based)
- `baseDelay` (number): The base delay in milliseconds

### Output
- Returns the calculated delay time in milliseconds

### Processing Logic
1. **Exponential Calculation**: Uses the formula `baseDelay * Math.pow(2, attempt - 1)`
2. **Return Result**: Returns the calculated delay time

### Example
```javascript
console.log(calculateDelay(1, 100)); // 100ms
console.log(calculateDelay(2, 100)); // 200ms
console.log(calculateDelay(3, 100)); // 400ms
console.log(calculateDelay(4, 100)); // 800ms
```

---

## Function: delay(ms)

### Description
Creates a promise-based delay for the specified duration.

### Input
- `ms` (number): Delay duration in milliseconds

### Output
- Returns a promise that resolves after the specified delay

### Processing Logic
1. **Promise Creation**: Creates a new Promise
2. **Timeout Setup**: Uses setTimeout to resolve the promise after the delay
3. **Return Promise**: Returns the promise

### Example
```javascript
// Wait for 500ms
await delay(500);
console.log('Delayed execution');
```

---

## Integration
This module is used by the main `runner.js` component to calculate and implement delays between retry attempts.
