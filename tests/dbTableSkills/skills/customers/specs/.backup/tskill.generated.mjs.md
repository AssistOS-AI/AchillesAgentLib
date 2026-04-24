# Specification for tskill.generated.mjs - Customers Database Functions

---

## Module Description

Generated functions for the **Customers** database table skill.

**Table Purpose:** Manage customer records including contact information and status for a business CRM system.

**Fields:** customer_id, name, email, status
**Derived Fields:** display_name

This module provides:
- Field validators (validator_<fieldName>) for data validation
- Field presenters (presenter_<fieldName>) for display formatting
- Field resolvers (resolver_<fieldName>) for input parsing
- Field enumerators (enumerator_<fieldName>) for allowed values
- Delete validator (validateDelete) for pre-delete guard checks
- Record-level functions for CRUD operations

**Business Rules:**
- Email addresses must be unique across all customer records
- Customer status can only transition from 'pending' to 'active' or 'inactive'
- Once suspended, customers cannot be set to 'active' without admin approval

---

## Dependencies

None (pure JavaScript/ESM implementation).

---

## Function: validator_customer_id(value, record)

### Description
Validates the **customer_id** field. Unique integer identifier for each customer (primary key, auto-increment)
**This field is required.**

### Input
- `value` (any): The customer_id value to validate
- `record` (object): The full record object for cross-field validation

### Processing Logic
1. If value is null, undefined, or empty string and field is required, return error JSON
2. Validate that value is a valid integer
3. If validation fails, return `JSON.stringify({field: 'customer_id', error: '<error message>', value: value})`
4. If validation passes, return empty string `''`

### Output
- **Invalid:** `'{"field":"customer_id","error":"<description>","value":"<value>"}'`
- **Valid:** `''` (empty string)

### CRITICAL
- Return type is STRING, not object
- Empty string means valid
- Non-empty string (JSON) means invalid

---

## Function: validator_name(value, record)

### Description
Validates the **name** field. Full name of the customer (string, max 200 characters)
**This field is required.**

### Input
- `value` (any): The name value to validate
- `record` (object): The full record object for cross-field validation

### Processing Logic
1. If value is null, undefined, or empty string and field is required, return error JSON
2. Validate: Must be between 2 and 200 characters. Cannot contain only numbers or special characters.
3. If validation fails, return `JSON.stringify({field: 'name', error: '<error message>', value: value})`
4. If validation passes, return empty string `''`

### Output
- **Invalid:** `'{"field":"name","error":"<description>","value":"<value>"}'`
- **Valid:** `''` (empty string)

### CRITICAL
- Return type is STRING, not object
- Empty string means valid
- Non-empty string (JSON) means invalid

---

## Function: validator_email(value, record)

### Description
Validates the **email** field. Email address for customer contact (string, unique)
**This field is required.**

### Input
- `value` (any): The email value to validate
- `record` (object): The full record object for cross-field validation

### Processing Logic
1. If value is null, undefined, or empty string and field is required, return error JSON
2. Validate: Must be a valid email format matching pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/
3. If validation fails, return `JSON.stringify({field: 'email', error: '<error message>', value: value})`
4. If validation passes, return empty string `''`

### Output
- **Invalid:** `'{"field":"email","error":"<description>","value":"<value>"}'`
- **Valid:** `''` (empty string)

### CRITICAL
- Return type is STRING, not object
- Empty string means valid
- Non-empty string (JSON) means invalid

---

## Function: validator_status(value, record)

### Description
Validates the **status** field. Current status of the customer account (enum: active, inactive, pending, suspended)
**This field is required.**

### Input
- `value` (any): The status value to validate
- `record` (object): The full record object for cross-field validation

### Processing Logic
1. If value is null, undefined, or empty string and field is required, return error JSON
2. Validate: Must be one of: active, inactive, pending, suspended
3. If validation fails, return `JSON.stringify({field: 'status', error: '<error message>', value: value})`
4. If validation passes, return empty string `''`

### Output
- **Invalid:** `'{"field":"status","error":"<description>","value":"<value>"}'`
- **Valid:** `''` (empty string)

### CRITICAL
- Return type is STRING, not object
- Empty string means valid
- Non-empty string (JSON) means invalid

---

## Function: presenter_name(value, record)

### Description
Formats the **name** field for display.
**Format:** Display the name in Title Case format

### Input
- `value` (any): The raw database value
- `record` (object): The full record object for context

### Processing Logic
1. If value is null or undefined, return `'—'` (em dash)
2. Display the name in Title Case format
3. Return the formatted string

### Output
Formatted display string suitable for user interface.

---

## Function: presenter_email(value, record)

### Description
Formats the **email** field for display.
**Format:** Display email in lowercase format

### Input
- `value` (any): The raw database value
- `record` (object): The full record object for context

### Processing Logic
1. If value is null or undefined, return `'—'` (em dash)
2. Display email in lowercase format
3. Return the formatted string

### Output
Formatted display string suitable for user interface.

---

## Function: presenter_status(value, record)

### Description
Formats the **status** field for display.
**Format:** Display status in uppercase with color coding context

### Input
- `value` (any): The raw database value
- `record` (object): The full record object for context

### Processing Logic
1. If value is null or undefined, return `'—'` (em dash)
2. Display status in uppercase with color coding context
3. Return the formatted string

### Output
Formatted display string suitable for user interface.

---

## Function: resolver_name(value, record)

### Description
Resolves user input for the **name** field into database format.
**Resolution:** Convert input to Title Case and trim whitespace

### Input
- `value` (any): The user-provided input value
- `record` (object): The current record object for context

### Processing Logic
1. If value is null or undefined, return null
2. Convert input to Title Case and trim whitespace
3. Return the resolved value suitable for database storage

### Output
Value in database-compatible format (string).

---

## Function: resolver_email(value, record)

### Description
Resolves user input for the **email** field into database format.
**Resolution:** Convert to lowercase and trim whitespace

### Input
- `value` (any): The user-provided input value
- `record` (object): The current record object for context

### Processing Logic
1. If value is null or undefined, return null
2. Convert to lowercase and trim whitespace
3. Return the resolved value suitable for database storage

### Output
Value in database-compatible format (email).

---

## Function: resolver_status(value, record)

### Description
Resolves user input for the **status** field into database format.
**Resolution:** Convert to lowercase and validate against allowed values

### Input
- `value` (any): The user-provided input value
- `record` (object): The current record object for context

### Processing Logic
1. If value is null or undefined, return null
2. Convert to lowercase and validate against allowed values
3. Return the resolved value suitable for database storage

### Output
Value in database-compatible format (string).

---

## Function: enumerator_status(context)

### Description
Returns the allowed values for the **status** field.
**Logic:** Return ["active", "inactive", "pending", "suspended"]
**Known Values:** `active`, `inactive`, `pending`, `suspended`

### Input
- `context` (object, optional): Execution context with potential filters or constraints

### Processing Logic
1. Return the predefined list of allowed values
2. Return as array of valid options

### Output
Array of allowed values: `["active","inactive","pending","suspended"]`

---

## Function: derivator_display_name(record)

### Description
Computes the derived value for the **display_name** field.
**Computation:** Concatenate name with status in parentheses. Example: "John Doe (active)"

### Input
- `record` (object): The full record object with source fields

### Processing Logic
1. Concatenate name with status in parentheses. Example: "John Doe (active)"
2. Return the computed value

### Output
Computed value for the display_name field.

---

## Function: generatePKValues(record, existingRecords)

### Description
Generates primary key values for new records.
**Primary Key Field:** `customer_id`
**Strategy:** Auto-increment starting from 1

### Input
- `record` (object): The record being created (may already have some fields)
- `existingRecords` (array, optional): Existing records for uniqueness checking

### Processing Logic
1. Check if primary key already exists in record
2. If not, generate using Auto-increment starting from 1
3. Return object with the primary key field

### Output
`{ customer_id: '<generated-value>' }`

### Implementation Note
For UUID strategy, use:
```javascript
import crypto from 'node:crypto';
// ...
return { customer_id: crypto.randomUUID() };
```

---

## Function: prepareRecord(record, context)

### Description
Transforms a record before database insertion. **Async function.**

### Input
- `record` (object): The raw record data from user input
- `context` (object, optional): Execution context

### Processing Logic
1. Create a copy of the input record
2. Call resolver functions for fields that have them:
   - resolver_name
   - resolver_email
   - resolver_status
3. Call derivator functions for derived fields:
   - derivator_display_name
4. Apply any default values for missing fields
5. Return the transformed record

### Output
Record object ready for database insertion with all transformations applied.

---

## Function: validateRecord(record)

### Description
Validates an entire record by running all field validators.

### Input
- `record` (object): The record to validate

### Processing Logic
1. Initialize errors array
2. Call each validator function:
   - validator_customer_id(record.customer_id, record)
   - validator_name(record.name, record)
   - validator_email(record.email, record)
   - validator_status(record.status, record)
3. Collect any non-empty error strings (parse JSON to extract error details)
4. Return validation result

### Output
```javascript
{
    isValid: boolean,  // true if no errors
    errors: [          // array of error objects
        { field: 'fieldName', error: 'message', value: 'badValue' },
        // ...
    ]
}
```

### Implementation Pattern
```javascript
async function validateRecord(record) {
    const errors = [];
    
    // Call each validator
    const validators = [
        ['customer_id', validator_customer_id],
        ['name', validator_name],
        ['email', validator_email],
        ['status', validator_status],
    ];
    
    for (const [fieldName, validatorFn] of validators) {
        const result = validatorFn(record[fieldName], record);
        if (result) {
            try {
                errors.push(JSON.parse(result));
            } catch {
                errors.push({ field: fieldName, error: result, value: record[fieldName] });
            }
        }
    }
    
    return { isValid: errors.length === 0, errors };
}
```

---

## Function: validateDelete(recordId, record, context)

### Description
Validates whether a record can be deleted before executing `deleteRecord`.

### Input
- `recordId` (string): Primary key value for the record being deleted
- `record` (object): Selected record from database (optional)
- `context` (object): Runtime context for delete validation

### Processing Logic
1. Initialize errors array
2. Read delete guard mode from `context.deleteGuard.mode`
3. If mode is `block_if_referenced`, call `context.checkDeleteReferences(recordId, record)` when available
4. If helper returns a message, push a structured error object
5. Return `{ isValid, errors }`

### Delete Guard
- Parsed mode: `none`
- Relationship hints:
  - none

### Output
```javascript
{
    isValid: boolean,
    errors: [
        { field: 'id', error: 'Cannot delete ... referenced by ...', value: recordId }
    ]
}
```

### Implementation Pattern
```javascript
async function validateDelete(recordId, record, context = {}) {
    const errors = [];
    const guardMode = String(context?.deleteGuard?.mode || '').toLowerCase();

    if (guardMode === 'block_if_referenced' && typeof context.checkDeleteReferences === 'function') {
        const message = await context.checkDeleteReferences(recordId, record);
        if (message) {
            errors.push({
                field: context.primaryKey || 'id',
                error: String(message),
                value: recordId,
            });
        }
    }

    return { isValid: errors.length === 0, errors };
}
```

---

## Function: presentRecord(record)

### Description
Formats an entire record for display by calling all presenter functions. **Async function.**

### Input
- `record` (object): The raw database record

### Processing Logic
1. Create a copy of the input record
2. For each field with a presenter function, call it:
   - presenter_name(record.name, record) → formatted value
   - presenter_email(record.email, record) → formatted value
   - presenter_status(record.status, record) → formatted value
3. Return the formatted record

### Output
Record object with all fields formatted for display.

### Implementation Pattern
```javascript
async function presentRecord(record) {
    if (!record) return record;
    const presented = { ...record };
    
    if (record.name !== undefined) {
        presented.name = presenter_name(record.name, record);
    }
    if (record.email !== undefined) {
        presented.email = presenter_email(record.email, record);
    }
    if (record.status !== undefined) {
        presented.status = presenter_status(record.status, record);
    }
    
    return presented;
}
```

---

## Exports Structure

The module **MUST** export a `functions` object with all functions under the `global` key:

```javascript
// All individual function exports
export { validator_customer_id, validator_name, validator_email, validator_status, presenter_name, ... };

// Main functions export object
export const functions = {
    global: {
        validator_customer_id,
        validator_name,
        validator_email,
        validator_status,
        presenter_name,
        presenter_email,
        presenter_status,
        resolver_name,
        resolver_email,
        resolver_status,
        enumerator_status,
        derivator_display_name,
        generatePKValues,
        prepareRecord,
        validateRecord,
        validateDelete,
        presentRecord,
    }
};
```

### Required Exports Summary
| Category | Functions |
|----------|-----------|
| Validators | validator_customer_id, validator_name, validator_email, validator_status |
| Presenters | presenter_name, presenter_email, presenter_status |
| Resolvers | resolver_name, resolver_email, resolver_status |
| Enumerators | enumerator_status |
| Derivators | derivator_display_name |
| Global | generatePKValues, prepareRecord, validateRecord, validateDelete, presentRecord |

---

## Main Functions

- `validator_customer_id(value, record)`: Validates the customer_id field. Required.
- `validator_name(value, record)`: Validates the name field. Required.
- `validator_email(value, record)`: Validates the email field. Required.
- `validator_status(value, record)`: Validates the status field. Required.
- `presenter_name(value, record)`: Formats name for display.
- `presenter_email(value, record)`: Formats email for display.
- `presenter_status(value, record)`: Formats status for display.
- `resolver_name(value, record)`: Resolves user input for name.
- `resolver_email(value, record)`: Resolves user input for email.
- `resolver_status(value, record)`: Resolves user input for status.
- `enumerator_status(context)`: Returns allowed values for status.
- `derivator_display_name(record)`: Computes derived value for display_name.
- `generatePKValues(record, existingRecords)`: Generates primary key values.
- `prepareRecord(record, context)`: Transforms record before database insertion.
- `validateRecord(record)`: Validates entire record by running all field validators.
- `validateDelete(recordId, record, context)`: Validates whether a record can be deleted.
- `presentRecord(record)`: Formats entire record for display.

---

## Exports

Named exports: `validator_customer_id`, `validator_name`, `validator_email`, `validator_status`, `presenter_name`, `presenter_email`, `presenter_status`, `resolver_name`, `resolver_email`, `resolver_status`, `enumerator_status`, `derivator_display_name`, `generatePKValues`, `prepareRecord`, `validateRecord`, `validateDelete`, `presentRecord`, `functions`

The `functions` export wraps all functions under a `global` key.

---

## Testing

### Validator Tests
Test each validator function with valid inputs (expect empty string) and invalid inputs (expect JSON error string).
- `validator_customer_id`: null/undefined/empty string → error; valid value → empty string
- `validator_name`: null/undefined/empty string → error; invalid format → error per: Must be between 2 and 200 characters. Cannot contain only numbers or special characters.; valid value → empty string
- `validator_email`: null/undefined/empty string → error; invalid format → error per: Must be a valid email format matching pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/; valid value → empty string
- `validator_status`: null/undefined/empty string → error; invalid format → error per: Must be one of: active, inactive, pending, suspended; valid value → empty string
### Presenter Tests
Test each presenter with null (expect '—'), and normal values.
- `presenter_name`: null → '—'; normal value → formatted per: Display the name in Title Case format
- `presenter_email`: null → '—'; normal value → formatted per: Display email in lowercase format
- `presenter_status`: null → '—'; normal value → formatted per: Display status in uppercase with color coding context
### Enumerator Tests
- `enumerator_status`: returns array containing 'active', 'inactive', 'pending', 'suspended'
### Record-Level Tests
- `validateRecord`: pass a valid record → isValid true; pass record with missing required fields → isValid false with errors
- `prepareRecord`: pass a record → returns transformed record with resolvers/derivators applied
- `presentRecord`: pass a record → returns record with presenter formatting applied
- `generatePKValues`: pass empty record → returns object with primary key field populated