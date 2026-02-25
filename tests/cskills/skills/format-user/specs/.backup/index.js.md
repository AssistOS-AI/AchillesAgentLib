# Specification for index.js

## Function: action(args)

### Description
Formats a user object into a standardized string.

### Input
- args: Object containing user data
  - user: Object representing the user
    - firstName (string, mandatory): The user's first name
    - lastName (string, mandatory): The user's last name
    - age (number, mandatory): The user's age

### Processing Logic
1. Receive the user object from args.user
2. Validate that the user object and all its mandatory properties (firstName, lastName, age) are present
3. If validation fails, return the exact string: "Error: Incomplete user data provided."
4. If validation succeeds, concatenate firstName and lastName with a space in between to form a fullName
5. Determine the user's status:
   - If age is 18 or greater, the status is "Adult"
   - If age is less than 18, the status is "Minor"
6. Construct and return a final string in the format: "Full Name: {fullName}, Age: {age} ({status})"

### Example
```javascript
// Input:
{
  "user": {
    "firstName": "Jane",
    "lastName": "Doe",
    "age": 25
  }
}

// Output:
"Full Name: Jane Doe, Age: 25 (Adult)"
```
