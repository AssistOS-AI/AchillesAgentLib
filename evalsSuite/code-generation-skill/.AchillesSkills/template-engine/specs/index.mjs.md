# Specification for index.mjs - Expression Evaluator Main Entry Point

## Module Description
This module is the main entry point for the expression evaluator skill. It orchestrates the tokenizer, parser, and evaluator, and provides built-in functions. The main export is an `action` function that evaluates expressions and returns computed results.

## Dependencies
- `./parser.js`: Tokenizer and Parser classes
- `./evaluator.js`: Evaluator class

---

## Built-in Functions Library

The skill provides a comprehensive library of built-in functions:

### String Functions

```javascript
uppercase: (str) => String(str).toUpperCase()
  // Example: uppercase('hello') → 'HELLO'

lowercase: (str) => String(str).toLowerCase()
  // Example: lowercase('HELLO') → 'hello'

length: (val) => {
  if (val == null) return 0;
  return val.length ?? 0;
}
  // Example: length('hello') → 5
  // Example: length([1,2,3]) → 3

concat: (...args) => args.map(a => String(a)).join('')
  // Example: concat('hello', ' ', 'world') → 'hello world'

substring: (str, start, end) => String(str).substring(start, end)
  // Example: substring('hello', 0, 3) → 'hel'

trim: (str) => String(str).trim()
  // Example: trim('  hello  ') → 'hello'

replace: (str, search, replacement) => String(str).replace(search, replacement)
  // Example: replace('hello', 'l', 'L') → 'heLlo'
```

### Math Functions

```javascript
abs: (n) => Math.abs(Number(n))
  // Example: abs(-5) → 5

max: (...nums) => Math.max(...nums.map(Number))
  // Example: max(10, 20, 5) → 20

min: (...nums) => Math.min(...nums.map(Number))
  // Example: min(10, 20, 5) → 5

round: (n, decimals = 0) => {
  const factor = Math.pow(10, decimals);
  return Math.round(Number(n) * factor) / factor;
}
  // Example: round(3.14159, 2) → 3.14

floor: (n) => Math.floor(Number(n))
  // Example: floor(3.7) → 3

ceil: (n) => Math.ceil(Number(n))
  // Example: ceil(3.2) → 4

sqrt: (n) => Math.sqrt(Number(n))
  // Example: sqrt(16) → 4

pow: (base, exponent) => Math.pow(Number(base), Number(exponent))
  // Example: pow(2, 3) → 8
```

### Array Functions

```javascript
first: (arr) => {
  if (!Array.isArray(arr)) return undefined;
  return arr[0];
}
  // Example: first([1, 2, 3]) → 1

last: (arr) => {
  if (!Array.isArray(arr)) return undefined;
  return arr[arr.length - 1];
}
  // Example: last([1, 2, 3]) → 3

sum: (arr) => {
  if (!Array.isArray(arr)) return 0;
  return arr.reduce((a, b) => Number(a) + Number(b), 0);
}
  // Example: sum([1, 2, 3, 4]) → 10

avg: (arr) => {
  if (!Array.isArray(arr) || arr.length === 0) return 0;
  return sum(arr) / arr.length;
}
  // Example: avg([1, 2, 3, 4]) → 2.5

size: (arr) => {
  if (!Array.isArray(arr)) return 0;
  return arr.length;
}
  // Example: size([1, 2, 3]) → 3
```

### Type Functions

```javascript
typeof: (val) => typeof val
  // Example: typeof(123) → 'number'

isArray: (val) => Array.isArray(val)
  // Example: isArray([1, 2]) → true

isNumber: (val) => typeof val === 'number' && !isNaN(val)
  // Example: isNumber(123) → true

isString: (val) => typeof val === 'string'
  // Example: isString('hello') → true

isBoolean: (val) => typeof val === 'boolean'
  // Example: isBoolean(true) → true
```

### Utility Functions

```javascript
default: (val, defaultVal) => (val == null || val === '') ? defaultVal : val
  // Example: default(null, 'N/A') → 'N/A'
  // Example: default('value', 'N/A') → 'value'

coalesce: (...args) => {
  for (const arg of args) {
    if (arg != null && arg !== '') return arg;
  }
  return null;
}
  // Example: coalesce(null, '', 'value', 'other') → 'value'
```

---

## BUILTIN_FUNCTIONS Constant

**CRITICAL**: All built-in functions MUST be defined in a constant object:

```javascript
const BUILTIN_FUNCTIONS = {
  // String functions
  uppercase: (str) => String(str).toUpperCase(),
  lowercase: (str) => String(str).toLowerCase(),
  length: (val) => (val == null) ? 0 : (val.length ?? 0),
  concat: (...args) => args.map(a => String(a)).join(''),
  substring: (str, start, end) => String(str).substring(start, end),
  trim: (str) => String(str).trim(),
  replace: (str, search, replacement) => String(str).replace(search, replacement),

  // Math functions
  abs: (n) => Math.abs(Number(n)),
  max: (...nums) => Math.max(...nums.map(Number)),
  min: (...nums) => Math.min(...nums.map(Number)),
  round: (n, decimals = 0) => {
    const factor = Math.pow(10, decimals);
    return Math.round(Number(n) * factor) / factor;
  },
  floor: (n) => Math.floor(Number(n)),
  ceil: (n) => Math.ceil(Number(n)),
  sqrt: (n) => Math.sqrt(Number(n)),
  pow: (base, exp) => Math.pow(Number(base), Number(exp)),

  // Array functions
  first: (arr) => Array.isArray(arr) ? arr[0] : undefined,
  last: (arr) => Array.isArray(arr) ? arr[arr.length - 1] : undefined,
  sum: (arr) => Array.isArray(arr) ? arr.reduce((a, b) => Number(a) + Number(b), 0) : 0,
  avg: (arr) => {
    if (!Array.isArray(arr) || arr.length === 0) return 0;
    const total = arr.reduce((a, b) => Number(a) + Number(b), 0);
    return total / arr.length;
  },
  size: (arr) => Array.isArray(arr) ? arr.length : 0,

  // Type functions
  typeof: (val) => typeof val,
  isArray: (val) => Array.isArray(val),
  isNumber: (val) => typeof val === 'number' && !isNaN(val),
  isString: (val) => typeof val === 'string',
  isBoolean: (val) => typeof val === 'boolean',

  // Utility functions
  default: (val, defaultVal) => (val == null || val === '') ? defaultVal : val,
  coalesce: (...args) => {
    for (const arg of args) {
      if (arg != null && arg !== '') return arg;
    }
    return null;
  }
};
```

---

## Function: action(args)

### Description
The main exported function that evaluates expressions. It coordinates tokenization, parsing, and evaluation.

### Input
- `args` (Object):
  - `operation` (string): Must be `'evaluate'`.
  - `expression` (string): The expression to evaluate.
  - `data` (object, optional): Context data for variable resolution (default: `{}`).

### Processing Logic

1. **Validate operation**:
   ```javascript
   if (operation !== 'evaluate') {
     throw new Error(`Unsupported operation: '${operation}'. Only 'evaluate' is supported.`);
   }
   ```

2. **Validate expression**:
   ```javascript
   if (typeof expression !== 'string' || expression.trim() === '') {
     throw new Error("Parameter 'expression' must be a non-empty string.");
   }
   ```

3. **Tokenize**:
   ```javascript
   const tokenizer = new Tokenizer();
   const tokens = tokenizer.tokenize(expression);
   ```

4. **Parse**:
   ```javascript
   const parser = new Parser(tokens);
   const ast = parser.parse();
   ```

5. **Prepare context**:
   ```javascript
   const context = {
     ...(data || {}),
     __functions: BUILTIN_FUNCTIONS
   };
   ```

6. **Evaluate**:
   ```javascript
   const evaluator = new Evaluator();
   const result = evaluator.evaluate(ast, context);
   ```

7. **Return result**:
   ```javascript
   return result;  // CRITICAL: Return primitive value directly, NOT wrapped in object
   ```

### Output
- Returns the computed result directly (number, string, boolean, array, object, etc.).
- **CRITICAL**: DO NOT wrap the result in an object like `{ result: value }`.
- Return the raw computed value.

### Error Handling

Catch and re-throw errors with helpful messages:
```javascript
try {
  // ... tokenize, parse, evaluate
} catch (error) {
  throw new Error(`Expression evaluation failed: ${error.message}`);
}
```

---

## CRITICAL IMPLEMENTATION PATTERN

```javascript
import { Tokenizer, Parser } from './parser.js';
import { Evaluator } from './evaluator.js';

const BUILTIN_FUNCTIONS = {
  // ... all functions defined above
};

export async function action(args = {}) {
  const { operation, expression, data } = args;

  // 1. Validate operation
  if (!operation || operation !== 'evaluate') {
    throw new Error(`Unsupported operation: '${operation}'. Only 'evaluate' is supported.`);
  }

  // 2. Validate expression
  if (typeof expression !== 'string' || expression.trim() === '') {
    throw new Error("Parameter 'expression' must be a non-empty string.");
  }

  try {
    // 3. Tokenize
    const tokenizer = new Tokenizer();
    const tokens = tokenizer.tokenize(expression);

    // 4. Parse
    const parser = new Parser(tokens);
    const ast = parser.parse();

    // 5. Prepare context with data and functions
    const context = {
      ...(data || {}),
      __functions: BUILTIN_FUNCTIONS
    };

    // 6. Evaluate
    const evaluator = new Evaluator();
    const result = evaluator.evaluate(ast, context);

    // 7. Return result directly (NOT wrapped)
    return result;

  } catch (error) {
    throw new Error(`Expression evaluation failed: ${error.message}`);
  }
}
```

---

## Example Usage

### Example 1: Simple math
```javascript
const result = await action({
  operation: 'evaluate',
  expression: '2 + 3 * 4',
  data: {}
});
// Returns: 14
```

### Example 2: Variable access
```javascript
const result = await action({
  operation: 'evaluate',
  expression: 'user.age * 2',
  data: { user: { age: 25 } }
});
// Returns: 50
```

### Example 3: Function call
```javascript
const result = await action({
  operation: 'evaluate',
  expression: 'uppercase(user.name)',
  data: { user: { name: 'john' } }
});
// Returns: 'JOHN'
```

### Example 4: Complex expression
```javascript
const result = await action({
  operation: 'evaluate',
  expression: 'user.age > 18 && user.active',
  data: { user: { age: 25, active: true } }
});
// Returns: true
```

### Example 5: Multiple function calls
```javascript
const result = await action({
  operation: 'evaluate',
  expression: 'max(10, 20, 30) + min(5, 3, 8)',
  data: {}
});
// Returns: 33 (30 + 3)
```

### Example 6: String manipulation
```javascript
const result = await action({
  operation: 'evaluate',
  expression: 'concat(uppercase(user.first), " ", uppercase(user.last))',
  data: { user: { first: 'john', last: 'doe' } }
});
// Returns: 'JOHN DOE'
```

---

## Integration with CodeSkillsSubsystem

The CodeSkillsSubsystem will dynamically import this module and call the `action` function directly with:
- `operation: 'evaluate'`
- `expression: string` - The expression to evaluate
- `data: object` - Optional context data

The result will be a primitive value (number, string, boolean) or composite value (array, object) that represents the computed expression result.

---

## CRITICAL NOTES

1. **Return value MUST be direct, not wrapped**:
   ```javascript
   return result;  // ✅ CORRECT
   return { result: result };  // ❌ WRONG
   return { data: result };  // ❌ WRONG
   ```

2. **Functions MUST be in context.__functions**:
   The evaluator expects functions in `context.__functions`, not at the root of context.

3. **Expression must be a valid string**:
   Empty strings or non-strings should throw clear errors.

4. **Error messages should be helpful**:
   Include the original error message when re-throwing to aid debugging.
