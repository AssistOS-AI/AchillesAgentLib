# Functional Specification for User Profile Formatter

## 1. Primary Function

The system shall format a user object into a standardized string.

## 2. Input Data

- A user object containing:
  - `firstName` (string, mandatory)
  - `lastName` (string, mandatory)
  - `age` (number, mandatory)

## 3. Processing Logic

1.  The function must receive the user object.
2.  It must validate that the user object and all its mandatory properties (`firstName`, `lastName`, `age`) are present.
3.  If validation fails, the function must return the exact string: "Error: Incomplete user data provided."
4.  If validation succeeds, the function must concatenate `firstName` and `lastName` with a space in between to form a `fullName`.
5.  The function must determine the user's status:
    - If `age` is 18 or greater, the status is "Adult".
    - If `age` is less than 18, the status is "Minor".
6.  The function must construct and return a final string in the format: "Full Name: {fullName}, Age: {age} ({status})".
