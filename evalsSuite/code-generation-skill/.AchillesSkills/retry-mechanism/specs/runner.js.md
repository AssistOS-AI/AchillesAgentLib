# Specification for runner.js - Retry Runner Component

## Module Description
This module implements the core retry logic with exponential backoff for executing error-prone functions.

## Dependencies
- `./delay.js`: Delay calculation functionality

---

## Class: RetryRunner

### Description
The `RetryRunner` class implements the retry logic with exponential backoff for executing functions.

### Constructor
- Initializes the retry runner
- Sets up delay calculation component

### Properties
- `delay`: Instance of the delay calculation component

### Methods

#### retry(fn, args, retries, baseDelay)
- **Description**: Executes a function with retry logic and exponential backoff
- **Input**:
  - `fn` (function): The function to retry
  - `args` (array): Arguments to pass to the function
  - `retries` (number): Maximum number of retry attempts
  - `baseDelay` (number): Base delay in milliseconds
- **Output**: `{ success: true, result: any, attempts: number, totalTime: number }` or `{ success: false, error: string, attempts: number }`
- **Process**:
  1. Initializes error tracking and attempt counter
  2. Loops through retry attempts
  3. For each attempt:
     - Executes the function with provided arguments
     - If successful, returns success with result and metrics
     - If failed and more attempts remain, calculates delay and waits
  4. If all attempts fail, returns failure with error and attempt count

---

## Integration
This module is used by the main `index.js` component to provide the retry functionality.
