# Specification for index.mjs - Token Bucket Rate Limiter

## Module Description
This module implements a token bucket rate limiter using the token bucket algorithm. It controls the frequency of operations by managing a pool of tokens that refill over time, with support for configurable refill rates and burst limits. The main export is an `action` function that provides access to the rate limiting functionality.

## Dependencies
None (pure JavaScript implementation).

---

## Class: RateLimiter

### Description
The `RateLimiter` class implements the token bucket rate limiting algorithm. It manages a pool of tokens that refill over time and allows consumption of tokens to control operation frequency.

### Constructor
- Initializes token count to 0.
- Sets last refill timestamp to current time.
- Sets default rate to { tokensPerSecond: 10, burstLimit: 20 }.

### Properties
- `tokens`: Current number of available tokens.
- `lastRefill`: Timestamp of last token refill.
- `rate`: Rate configuration object.

### Methods

#### setRate(rate)
- **Description**: Configures the rate limiter with new parameters.
- **Input**: `rate` (object) - Rate configuration with tokensPerSecond and burstLimit.
- **Output**: `{ success: true }` - Confirmation of rate change.
- **Process**:
  1. Updates the rate configuration.
  2. Ensures current tokens don't exceed the new burst limit.
  3. Returns success confirmation.

#### refill()
- **Description**: Refills tokens based on elapsed time (internal method).
- **Output**: (number) - Current token count after refill.
- **Process**:
  1. Calculates time passed since last refill.
  2. Computes new tokens based on rate and time passed.
  3. Adds new tokens to current count, not exceeding burst limit.
  4. Updates last refill timestamp.
  5. Returns current token count.

#### consume(tokens)
- **Description**: Attempts to consume tokens for an operation.
- **Input**: `tokens` (number) - Number of tokens to consume.
- **Output**: `{ success: true, remaining: number }` or `{ success: false, remaining: number }`.
- **Process**:
  1. Calls refill() to update token count.
  2. If sufficient tokens available: consumes them and returns success.
  3. If insufficient tokens: returns failure with remaining token count.

#### getStatus()
- **Description**: Returns current rate limiter status.
- **Output**: `{ tokens: number, rate: object }` - Current token count and rate configuration.
- **Process**:
  1. Calls refill() to update token count.
  2. Returns current token count and rate configuration.

---

## Function: action(args)

### Description
The main exported function and the designated entry point for execution. It acts as a dispatcher for the rate limiter functionality.

### Input
- `args` (Object):
  - `operation` (string): The operation to perform. Can be `setRate`, `consume`, or `getStatus`.
  - `rate` (object, optional): Rate configuration for setRate operation.
  - `tokens` (number, optional): Number of tokens to consume for consume operation.

### Processing Logic
1. Destructures `operation`, `rate`, and `tokens` from the `args` object.
2. Validates that operation parameter is present.
3. **For `setRate` operation**: Validates rate is provided, then calls the `setRate` method.
4. **For `consume` operation**: Validates tokens is provided, then calls the `consume` method.
5. **For `getStatus` operation**: Calls the `getStatus` method.
6. **For unknown operations**: Throws an error indicating the operation is not supported.

### Output
- **setRate**: `{ success: true }` - Confirmation of rate change.
- **consume**: `{ success: true, remaining: number }` or `{ success: false, remaining: number }` - Consumption result.
- **getStatus**: `{ tokens: number, rate: object }` - Current status.

---

## Module Usage

This module exports an `action` function that can be imported and called directly by the CodeSkillsSubsystem.

### Direct Import Usage
```javascript
import { action } from './index.mjs';

// Set rate limit
const setResult = await action({
  operation: 'setRate',
  rate: { tokensPerSecond: 5, burstLimit: 10 }
});

console.log('Rate set:', setResult);

// Consume tokens
const consumeResult = await action({
  operation: 'consume',
  tokens: 3
});

if (consumeResult.success) {
  console.log('Tokens consumed successfully. Remaining:', consumeResult.remaining);
} else {
  console.log('Rate limit exceeded. Remaining tokens:', consumeResult.remaining);
}

// Get status
const statusResult = await action({
  operation: 'getStatus'
});

console.log('Current status:', statusResult);
```

### Integration with CodeSkillsSubsystem
The CodeSkillsSubsystem will dynamically import this module and call the `action` function directly, eliminating the need for child process communication and improving performance and reliability.
