# Specification for parser.js - Expression Parser

## Module Description
This module implements a tokenizer and parser for converting expression strings into Abstract Syntax Trees (AST). It handles mathematical expressions, variable access, function calls, and operators with proper precedence.

## Dependencies
None (pure JavaScript implementation).

---

## Token Types

The tokenizer produces tokens with the following types:

```javascript
{
  NUMBER: 'NUMBER',           // 123, 45.67
  STRING: 'STRING',           // 'hello', "world"
  IDENTIFIER: 'IDENTIFIER',   // user, name, age
  OPERATOR: 'OPERATOR',       // +, -, *, /, %, **
  COMPARISON: 'COMPARISON',   // ==, !=, >, <, >=, <=
  LOGICAL: 'LOGICAL',         // &&, ||
  NOT: 'NOT',                 // !
  DOT: 'DOT',                 // .
  COMMA: 'COMMA',             // ,
  LPAREN: 'LPAREN',           // (
  RPAREN: 'RPAREN',           // )
  EOF: 'EOF'                  // End of input
}
```

---

## Class: Tokenizer

### Description
Converts an expression string into an array of tokens.

### Constructor
- Takes no parameters.

### Methods

#### tokenize(input)
- **Description**: Tokenizes an input expression string.
- **Input**: `input` (string) - The expression to tokenize.
- **Output**: Array of token objects `[{ type: string, value: any }, ...]`.
- **Process**:
  1. Initialize position counter and result array.
  2. Skip whitespace characters.
  3. Identify and extract tokens:
     - Numbers: sequences of digits, including decimals (e.g., "123", "45.67").
     - Strings: quoted text with single or double quotes (e.g., 'hello', "world").
     - Operators: arithmetic operators (+, -, *, /, %, **).
     - Comparisons: ==, !=, >, <, >=, <=.
     - Logical: &&, ||, !.
     - Identifiers: variable names (e.g., user, name, age).
     - Punctuation: dots, commas, parentheses.
  4. Return array of tokens ending with EOF token.

**Example:**
```javascript
tokenize("2 + 3 * 4")
// Returns:
[
  { type: 'NUMBER', value: 2 },
  { type: 'OPERATOR', value: '+' },
  { type: 'NUMBER', value: 3 },
  { type: 'OPERATOR', value: '*' },
  { type: 'NUMBER', value: 4 },
  { type: 'EOF', value: null }
]
```

---

## AST Node Types

The parser produces AST nodes with the following structures:

### Literal Node
```javascript
{ type: 'Literal', value: number|string|boolean }
```

### Identifier Node (variable access)
```javascript
{ type: 'Identifier', name: string }
```

### MemberExpression Node (object property access like user.age)
```javascript
{
  type: 'MemberExpression',
  object: Node,      // Left side (e.g., user)
  property: Node     // Right side (e.g., age)
}
```

### BinaryExpression Node (arithmetic, comparison, logical)
```javascript
{
  type: 'BinaryExpression',
  operator: string,  // +, -, *, /, %, **, ==, !=, >, <, >=, <=, &&, ||
  left: Node,
  right: Node
}
```

### UnaryExpression Node (negation)
```javascript
{
  type: 'UnaryExpression',
  operator: string,  // !, -
  argument: Node
}
```

### CallExpression Node (function calls)
```javascript
{
  type: 'CallExpression',
  callee: Node,      // Function name (Identifier)
  arguments: [Node]  // Array of argument nodes
}
```

---

## Class: Parser

### Description
Parses an array of tokens into an Abstract Syntax Tree with proper operator precedence.

### Constructor
- **Input**: `tokens` (array) - Array of token objects from tokenizer.
- Initializes position counter to 0.

### Operator Precedence (lowest to highest)
1. Logical OR: `||`
2. Logical AND: `&&`
3. Comparison: `==`, `!=`, `>`, `<`, `>=`, `<=`
4. Addition/Subtraction: `+`, `-`
5. Multiplication/Division: `*`, `/`, `%`
6. Exponentiation: `**`
7. Unary: `!`, `-`
8. Member access: `.`
9. Function calls: `()`

### Methods

#### parse()
- **Description**: Main entry point that parses tokens into AST.
- **Output**: AST root node.
- **Process**: Calls `parseExpression()` and ensures all tokens are consumed.

#### parseExpression()
- **Description**: Parses a complete expression starting with lowest precedence.
- **Output**: AST node.
- **Process**: Calls `parseLogicalOr()` to start precedence chain.

#### parseLogicalOr()
- **Description**: Parses logical OR expressions (lowest precedence).
- **Process**:
  1. Parse left side with `parseLogicalAnd()`.
  2. While current token is `||`, parse right side.
  3. Create BinaryExpression node.

#### parseLogicalAnd()
- **Description**: Parses logical AND expressions.
- Similar process to parseLogicalOr but for `&&`.

#### parseComparison()
- **Description**: Parses comparison expressions (==, !=, >, <, >=, <=).
- Similar process for comparison operators.

#### parseAdditive()
- **Description**: Parses addition and subtraction (+, -).
- Similar process for +, -.

#### parseMultiplicative()
- **Description**: Parses multiplication, division, modulo (*, /, %).
- Similar process for *, /, %.

#### parseExponentiation()
- **Description**: Parses exponentiation (**).
- Right-associative: 2**3**2 = 2**(3**2).

#### parseUnary()
- **Description**: Parses unary operators (!, -).
- **Process**:
  1. If token is ! or -, create UnaryExpression.
  2. Otherwise, call `parsePostfix()`.

#### parsePostfix()
- **Description**: Parses member access and function calls.
- **Process**:
  1. Parse primary expression.
  2. While token is . or (:
     - For `.`: Create MemberExpression.
     - For `(`: Create CallExpression.

#### parsePrimary()
- **Description**: Parses primary expressions (numbers, strings, identifiers, parentheses).
- **Process**:
  1. NUMBER → Literal node.
  2. STRING → Literal node.
  3. IDENTIFIER → Identifier node.
  4. LPAREN → Parse grouped expression, expect RPAREN.

#### parseArguments()
- **Description**: Parses function call arguments.
- **Output**: Array of AST nodes.
- **Process**:
  1. Parse comma-separated expressions.
  2. Stop at RPAREN.

---

## Export

```javascript
export class Tokenizer { ... }
export class Parser { ... }
```

---

## CRITICAL IMPLEMENTATION NOTES

### 1. Tokenizer must handle all cases:
```javascript
// Numbers
"123" → { type: 'NUMBER', value: 123 }
"45.67" → { type: 'NUMBER', value: 45.67 }

// Strings (both quote types)
"'hello'" → { type: 'STRING', value: 'hello' }
'"world"' → { type: 'STRING', value: 'world' }

// Multi-character operators
"==" → { type: 'COMPARISON', value: '==' }
"&&" → { type: 'LOGICAL', value: '&&' }
"**" → { type: 'OPERATOR', value: '**' }
```

### 2. Parser must respect precedence:
```javascript
// "2 + 3 * 4" should parse as:
{
  type: 'BinaryExpression',
  operator: '+',
  left: { type: 'Literal', value: 2 },
  right: {
    type: 'BinaryExpression',
    operator: '*',
    left: { type: 'Literal', value: 3 },
    right: { type: 'Literal', value: 4 }
  }
}
// NOT as ((2 + 3) * 4)
```

### 3. Member access must chain correctly:
```javascript
// "user.profile.name" should parse as:
{
  type: 'MemberExpression',
  object: {
    type: 'MemberExpression',
    object: { type: 'Identifier', name: 'user' },
    property: { type: 'Identifier', name: 'profile' }
  },
  property: { type: 'Identifier', name: 'name' }
}
```

### 4. Function calls must parse arguments:
```javascript
// "max(10, 20, 30)" should parse as:
{
  type: 'CallExpression',
  callee: { type: 'Identifier', name: 'max' },
  arguments: [
    { type: 'Literal', value: 10 },
    { type: 'Literal', value: 20 },
    { type: 'Literal', value: 30 }
  ]
}
```

---

## Example Usage

```javascript
import { Tokenizer, Parser } from './parser.js';

const tokenizer = new Tokenizer();
const tokens = tokenizer.tokenize("2 + 3 * 4");

const parser = new Parser(tokens);
const ast = parser.parse();

console.log(ast);
// Outputs AST structure
```
