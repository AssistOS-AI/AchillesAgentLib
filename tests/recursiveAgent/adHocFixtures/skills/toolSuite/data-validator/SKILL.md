# Data Validator

Validates structured data against business rules and returns validation results.

## Instructions

Given JSON data, validate each record against these rules:
- All required fields must be present and non-empty
- Quantity values must be non-negative integers
- Amount values must be positive numbers
- Email fields must contain an @ symbol
- Status fields must be one of: active, inactive, pending, archived

Return a JSON object with:
- `valid`: boolean indicating if all records pass
- `totalChecked`: number of records checked
- `errors`: array of objects with { recordId, field, message } for any failures
- `summary`: text description of validation results

Always return valid JSON.

## Input Format

- data: JSON data to validate
