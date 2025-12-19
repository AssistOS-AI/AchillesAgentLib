# Specification for index.mjs - Retry Mechanism with Exponential Backoff

## Module Description
This module implements a retry mechanism with exponential backoff for handling error-prone functions. It automatically re-executes failed functions with increasing delays between attempts, supporting configurable retry counts and base delay times. The main export is an `action` function that provides access to the retry functionality.

## Dependencies
None (pure JavaScript implementation).

---

## Function: delay(ms)

### Description
Internal utility function that creates a promise-based delay.

### Input
- `ms` (number): Delay time in milliseconds.

### Output
- Returns a promise that resolves after the specified delay.

---

## Class: RetryMechanism

### Description
The `RetryMechanism` class implements the core retry functionality with exponential backoff. It handles the retry logic, delay calculations, and error management.

### Constructor
- Initializes the retry mechanism (no properties needed).

### Methods

#### retry(fn, args, retries, baseDelay)
- **Description**: Executes a function with retry logic and exponential backoff.
- **Input**:
  - `fn` (function): The function to retry.
  - `args` (array, optional): Arguments to pass to the function (default: []).
  - `retries` (number, optional): Maximum number of retry attempts (default: 3).
  - `baseDelay` (number, optional): Base delay in milliseconds (default: 100).
- **Output**: `{ success: true, result: any, attempts: number, totalTime: number }` on success, or `{ success: false, error: string, attempts: number }` on failure.
- **Process**:
  1. Initializes error tracking and attempt counter.
  2. Loops through retry attempts (1 to retries).
  3. For each attempt:
     - Executes the function with provided arguments and current attempt number.
     - If successful, returns success object with result, attempts, and total time.
     - If failed and more attempts remain, calculates exponential delay and waits.
  4. If all attempts fail, returns failure object with error and attempt count.

---

## Function: action(args)

### Description
The main exported function and the designated entry point for execution. It acts as a dispatcher for the retry mechanism functionality.

### Input
- `args` (Object):
  - `operation` (string): The operation to perform (currently only 'retry' is supported).
  - `function` (function): The function to retry.
  - `args` (array, optional): Arguments to pass to the function.
  - `retries` (number, optional): Maximum number of retry attempts.
  - `baseDelay` (number, optional): Base delay in milliseconds.

### Processing Logic
1. Destructures `operation`, `function`, `args`, `retries`, and `baseDelay` from the `args` object.
2. Validates that required parameters (operation and function) are present.
3. **For `retry` operation**: Calls the `retry` method with the provided parameters.
4. **For unknown operations**: Throws an error indicating the operation is not supported.

### Output
- **retry**: `{ success: true, result: any, attempts: number, totalTime: number }` on success, or `{ success: false, error: string, attempts: number }` on failure.

---

## Module Usage

This module exports an `action` function that can be imported and called directly by the CodeSkillsSubsystem.

### Direct Import Usage
```javascript
import { action } from './index.mjs';

// Create a function that fails twice then succeeds
const testFunction = async (attempt) => {
  if (attempt < 3) {
    throw new Error(`Attempt ${attempt} failed`);
  }
  return `Success on attempt ${attempt}`;
};

// Retry the function
const retryResult = await action({
  operation: 'retry',
  function: testFunction,
  args: [],
  retries: 5,
  baseDelay: 100
});

if (retryResult.success) {
  console.log('Success:', retryResult.result);
  console.log('Attempts:', retryResult.attempts);
  console.log('Total time:', retryResult.totalTime, 'ms');
} else {
  console.log('Failed after', retryResult.attempts, 'attempts');
  console.log('Error:', retryResult.error);
}
```

### Integration with CodeSkillsSubsystem
The CodeSkillsSubsystem will dynamically import this module and call the `action` function directly, eliminating the need for child process communication and improving performance and reliability.
