# Specification for transformer.js - CSV Transformer Component

## Module Description
This module implements the transformation logic for parsed CSV data. It provides functionality for field mapping and filtering based on specified conditions.

## Dependencies
None (pure JavaScript implementation).

---

## Function: transform(data, config)

### Description
Applies transformations to parsed CSV data according to the provided configuration.

### Input
- `data` (array): Array of objects representing parsed CSV data
- `config` (object): Transformation configuration with optional properties:
  - `fieldMappings` (object): Mapping of old field names to new field names
  - `filters` (object): Filter conditions to apply to the data

### Output
- Returns a new array of objects with transformations applied

### Processing Logic

#### Field Mapping
1. **Input Validation**: Checks if `config.fieldMappings` exists
2. **Mapping Process**: For each object in the data array:
   - Creates a copy of the original object
   - For each mapping in `fieldMappings`:
     - If the old key exists in the object, copies its value to the new key
     - Removes the old key from the object
   - Returns the transformed object

#### Filtering
1. **Input Validation**: Checks if `config.filters` exists
2. **Filter Process**: Filters the data array based on conditions:
   - For each condition in `filters`:
     - Supports `gt` (greater than) and `lt` (less than) operators
     - Converts values to numbers for comparison
     - Only keeps objects that meet all conditions

### Example
```javascript
const data = [
  { name: 'John', age: '25', email: 'john@example.com' },
  { name: 'Jane', age: '30', email: 'jane@example.com' },
  { name: 'Bob', age: '35', email: 'bob@example.com' }
];

const config = {
  fieldMappings: { name: 'fullName', age: 'userAge' },
  filters: { userAge: { gt: 25 } }
};

const result = transform(data, config);
// Returns:
// [
//   { fullName: 'Jane', userAge: '30', email: 'jane@example.com' },
//   { fullName: 'Bob', userAge: '35', email: 'bob@example.com' }
// ]
```

### Validation
- Input: Valid array of objects and properly formatted configuration
- Output: Transformed array with correct field names and filtered results
- Edge Cases: Empty configuration, no matching filters, missing fields

---

## Integration
This module is used by the main `index.js` component to provide transformation capabilities for the CSV Parser skill.
