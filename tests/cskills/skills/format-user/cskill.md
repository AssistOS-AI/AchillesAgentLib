# User Profile Formatter

## Summary
Formats a user's data into a readable string based on external functional specifications.

## Input Format
- **user**: An object representing the user.
  - `firstName` (string): The user's first name.
  - `lastName` (string): The user's last name.
  - `age` (number): The user's age.

## Output Format
- **Type**: `string`
- **Success Example**: "Full Name: Jane Doe, Age: 25 (Adult)"
- **Error Example**: "Error: Incomplete user data provided."

## Constraints
- The generated code must handle cases where the 'user' object or its properties are null or undefined.

## Examples
### Example 1
- **Input args**: `{ "user": { "firstName": "Jane", "lastName": "Doe", "age": 25 } }`
- **Expected Output**: "Full Name: Jane Doe, Age: 25 (Adult)"