# Specification for evaluator.js - AST Evaluator

## Module Description
This module implements an evaluator that traverses an Abstract Syntax Tree (AST) and computes the result by applying operators, resolving variables, and calling functions.

## Dependencies
None (pure JavaScript implementation).

---

## Class: Evaluator

### Description
The `Evaluator` class walks an AST and computes the final result by evaluating each node type according to its semantics.

### Constructor
- Takes no parameters.

### Methods

#### evaluate(node, context)
- **Description**: Main evaluation method that dispatches to specific handlers based on node type.
- **Input**:
  - `node` (object): AST node to evaluate.
  - `context` (object): Data context containing variables and functions.
- **Output**: Computed result (number, string, boolean, etc.).
- **Process**:
  1. Check node type.
  2. Dispatch to appropriate handler method.
  3. Return computed result.

---

## Node Type Handlers

### evaluateLiteral(node, context)
- **Description**: Evaluates literal values.
- **Input**: `{ type: 'Literal', value: any }`
- **Output**: Returns `node.value` directly.
- **Example**: `{ type: 'Literal', value: 42 }` → `42`

---

### evaluateIdentifier(node, context)
- **Description**: Resolves variable names from context.
- **Input**: `{ type: 'Identifier', name: string }`
- **Output**: Value from context or undefined.
- **Process**:
  1. Look up `node.name` in context.
  2. Return the value or undefined if not found.
- **Example**:
  - Node: `{ type: 'Identifier', name: 'age' }`
  - Context: `{ age: 25 }`
  - Result: `25`

---

### evaluateMemberExpression(node, context)
- **Description**: Resolves object property access (e.g., user.age).
- **Input**: `{ type: 'MemberExpression', object: Node, property: Node }`
- **Output**: Property value.
- **Process**:
  1. Evaluate the object node to get the base object.
  2. Evaluate the property node to get the property name.
  3. Access the property on the object: `object[property]`.
  4. Return the value or undefined.
- **Example**:
  - Node: MemberExpression for `user.age`
  - Context: `{ user: { age: 25 } }`
  - Process:
    - Evaluate object → `{ age: 25 }`
    - Evaluate property → `'age'`
    - Result: `25`

**CRITICAL**: Handle nested access correctly:
```javascript
// user.profile.name
// 1. Evaluate user → { profile: { name: 'John' } }
// 2. Evaluate user.profile → { name: 'John' }
// 3. Evaluate user.profile.name → 'John'
```

---

### evaluateBinaryExpression(node, context)
- **Description**: Evaluates binary operations (arithmetic, comparison, logical).
- **Input**: `{ type: 'BinaryExpression', operator: string, left: Node, right: Node }`
- **Output**: Computed result.
- **Process**:
  1. Evaluate left operand.
  2. Evaluate right operand.
  3. Apply operator and return result.

**Supported operators:**

#### Arithmetic Operators:
```javascript
'+': (a, b) => a + b
'-': (a, b) => a - b
'*': (a, b) => a * b
'/': (a, b) => a / b
'%': (a, b) => a % b
'**': (a, b) => a ** b
```

#### Comparison Operators:
```javascript
'==': (a, b) => a == b   // Loose equality
'!=': (a, b) => a != b
'>': (a, b) => a > b
'<': (a, b) => a < b
'>=': (a, b) => a >= b
'<=': (a, b) => a <= b
```

#### Logical Operators:
```javascript
'&&': (a, b) => a && b
'||': (a, b) => a || b
```

**Examples:**
```javascript
// 2 + 3
{ operator: '+', left: 2, right: 3 } → 5

// 10 > 5
{ operator: '>', left: 10, right: 5 } → true

// true && false
{ operator: '&&', left: true, right: false } → false
```

---

### evaluateUnaryExpression(node, context)
- **Description**: Evaluates unary operations (negation, not).
- **Input**: `{ type: 'UnaryExpression', operator: string, argument: Node }`
- **Output**: Computed result.
- **Process**:
  1. Evaluate the argument.
  2. Apply unary operator.

**Supported operators:**
```javascript
'!': (a) => !a     // Logical NOT
'-': (a) => -a     // Arithmetic negation
```

**Examples:**
```javascript
// !true
{ operator: '!', argument: true } → false

// -(5)
{ operator: '-', argument: 5 } → -5
```

---

### evaluateCallExpression(node, context)
- **Description**: Evaluates function calls.
- **Input**: `{ type: 'CallExpression', callee: Node, arguments: [Node] }`
- **Output**: Function return value.
- **Process**:
  1. Evaluate callee to get function name.
  2. Evaluate all argument nodes to get argument values.
  3. Look up function in `context.__functions`.
  4. Call the function with evaluated arguments.
  5. Return the result.

**CRITICAL**: Functions are stored in `context.__functions`:
```javascript
const context = {
  user: { age: 25 },
  __functions: {
    uppercase: (str) => String(str).toUpperCase(),
    max: (...nums) => Math.max(...nums)
  }
};
```

**Example:**
```javascript
// uppercase('hello')
Node: {
  type: 'CallExpression',
  callee: { type: 'Identifier', name: 'uppercase' },
  arguments: [{ type: 'Literal', value: 'hello' }]
}

Process:
1. Evaluate callee → 'uppercase'
2. Evaluate arguments → ['hello']
3. Look up context.__functions['uppercase']
4. Call uppercase('hello')
5. Return 'HELLO'
```

**Error handling:**
- If function not found in `context.__functions`, throw error: `"Function '${name}' is not defined"`
- If callee is not an identifier, throw error: `"Invalid function call"`

---

## Main Evaluate Method Implementation Pattern

```javascript
evaluate(node, context) {
  if (!node) {
    throw new Error('Invalid node: node is null or undefined');
  }

  switch (node.type) {
    case 'Literal':
      return this.evaluateLiteral(node, context);

    case 'Identifier':
      return this.evaluateIdentifier(node, context);

    case 'MemberExpression':
      return this.evaluateMemberExpression(node, context);

    case 'BinaryExpression':
      return this.evaluateBinaryExpression(node, context);

    case 'UnaryExpression':
      return this.evaluateUnaryExpression(node, context);

    case 'CallExpression':
      return this.evaluateCallExpression(node, context);

    default:
      throw new Error(`Unknown node type: ${node.type}`);
  }
}
```

---

## Export

```javascript
export class Evaluator { ... }
```

---

## CRITICAL IMPLEMENTATION NOTES

### 1. Context structure:
```javascript
const context = {
  // User data
  user: { age: 25, name: 'John' },
  items: [1, 2, 3],

  // Built-in functions (MUST be in __functions)
  __functions: {
    uppercase: (str) => ...,
    max: (...nums) => ...,
    // ... more functions
  }
};
```

### 2. Member access must handle nested paths:
```javascript
// user.profile.name
Context: { user: { profile: { name: 'John' } } }

Step 1: Evaluate MemberExpression(user, profile)
  - Evaluate object: Identifier('user') → { profile: { name: 'John' } }
  - Evaluate property: Identifier('profile') → 'profile'
  - Result: { name: 'John' }

Step 2: Evaluate MemberExpression(result, name)
  - Object: { name: 'John' }
  - Property: 'name'
  - Result: 'John'
```

### 3. Short-circuit evaluation for logical operators:
```javascript
// For '&&': If left is falsy, don't evaluate right
// For '||': If left is truthy, don't evaluate right

'&&': (left, right) => {
  const leftVal = evaluate(left, context);
  if (!leftVal) return leftVal;  // Short-circuit
  return evaluate(right, context);
}

'||': (left, right) => {
  const leftVal = evaluate(left, context);
  if (leftVal) return leftVal;  // Short-circuit
  return evaluate(right, context);
}
```

### 4. Type coercion for operators:
JavaScript automatically handles type coercion, but be aware:
```javascript
// String concatenation
'hello' + ' world' → 'hello world'

// Number + String = String
5 + ' items' → '5 items'

// Comparison with type coercion
'5' == 5 → true (loose equality)
```

---

## Example Usage

```javascript
import { Evaluator } from './evaluator.js';

const evaluator = new Evaluator();

const ast = {
  type: 'BinaryExpression',
  operator: '+',
  left: { type: 'Literal', value: 2 },
  right: { type: 'Literal', value: 3 }
};

const result = evaluator.evaluate(ast, {});
console.log(result); // 5
```

## Complex Example

```javascript
// Expression: "user.age * 2 + 10"
const ast = {
  type: 'BinaryExpression',
  operator: '+',
  left: {
    type: 'BinaryExpression',
    operator: '*',
    left: {
      type: 'MemberExpression',
      object: { type: 'Identifier', name: 'user' },
      property: { type: 'Identifier', name: 'age' }
    },
    right: { type: 'Literal', value: 2 }
  },
  right: { type: 'Literal', value: 10 }
};

const context = {
  user: { age: 25 }
};

const result = evaluator.evaluate(ast, context);
console.log(result); // 60 (25 * 2 + 10)
```
