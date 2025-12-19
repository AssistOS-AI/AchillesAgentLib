# Specification for index.js - CSV Parser Main Component

## Module Description
This module serves as the main entry point for the CSV Parser skill. It orchestrates the parsing and transformation components and provides the public API through the `action` function.

## Dependencies
- `./parser.js`: CSV parsing functionality
- `./transformer.js`: Data transformation functionality

---

## Class: CSVParser

### Description
The `CSVParser` class coordinates the parsing and transformation of CSV data. It instantiates and manages the parsing and transformation components.

### Constructor
- Initializes the CSV parser instance
- Sets up the necessary components for parsing and transformation

### Methods

#### parse(csvString)
- **Description**: Delegates CSV parsing to the parser component
- **Input**: `csvString` (string) - CSV data as a string
- **Output**: Array of objects representing parsed CSV data
- **Process**: Calls the parser component's parse function

#### transform(data, config)
- **Description**: Delegates data transformation to the transformer component
- **Input**:
  - `data` (array) - Parsed CSV data
  - `config` (object) - Transformation configuration
- **Output**: Transformed array of objects
- **Process**: Calls the transformer component's transform function

---

## Function: action(args)

### Description
The main exported function and public API for the CSV Parser skill. It acts as a dynamic dispatcher that routes requests to the appropriate methods based on the operation specified in the arguments.

### Input
- `args` (Object):
  - `operation` (string): The operation to perform ('parse', 'transform', or 'parseAndTransform')
  - `csvString` (string): The CSV data as a string (required for parse operations)
  - `transformConfig` (object, optional): Transformation configuration (required for transform operations)

### Processing Logic
1. **Input Validation**: Validates that required parameters are present
2. **Operation Routing**:
   - **parse**: Calls `csvParser.parse()` and returns parsed data
   - **transform**: Calls `csvParser.parse()` then `csvParser.transform()` and returns transformed data
   - **parseAndTransform**: Calls both parse and transform, returns both results
3. **Error Handling**: Throws appropriate errors for invalid operations or missing parameters

### Output
- **parse**: `{ parsedData: [...] }` - Array of parsed objects
- **transform**: `{ transformedData: [...] }` - Array of transformed objects
- **parseAndTransform**: `{ parsedData: [...], transformedData: [...] }` - Both parsed and transformed data

### Example Usage
```javascript
// Parse CSV data
const parseResult = await action({
  operation: 'parse',
  csvString: 'name,age\nJohn,25\nJane,30'
});
console.log('Parsed:', parseResult.parsedData);

// Parse and transform CSV data
const transformResult = await action({
  operation: 'parseAndTransform',
  csvString: 'name,age\nJohn,25\nJane,30',
  transformConfig: {
    fieldMappings: { name: 'fullName', age: 'userAge' },
    filters: { userAge: { gt: 25 } }
  }
});
console.log('Transformed:', transformResult.transformedData);
```

### Integration
This module is the main entry point that will be dynamically imported and called by the CodeSkillsSubsystem. It provides a unified interface for all CSV parsing and transformation operations.

---

## Validation Requirements
1. **Input Validation**: All operations must validate required parameters
2. **Error Handling**: Appropriate error messages for invalid operations
3. **Data Integrity**: Parsed and transformed data must maintain structural integrity
4. **Performance**: Operations should complete efficiently even with larger CSV datasets
