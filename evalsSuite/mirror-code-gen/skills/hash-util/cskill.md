# Hash Utility

Provides password hashing and verification using cryptographic functions.

## Description
This skill implements a utility for generating and verifying cryptographic hashes. It supports password hashing with salt and verification of hashed passwords. All operations are exposed through a single, dynamic entry point.

## Input Format
The skill is invoked via an `action` function that accepts an object with a `promptText` string. The `promptText` must use `key: value` pairs, one per line.

- **promptText** (string): Multi-line text containing `key: value` pairs.
  - `operation` (string, mandatory): `hash` or `verify`.
  - `data` (string, mandatory): The data to hash or verify.
  - `salt` (string, optional for hash): The salt to use for hashing.
  - `hash` (string, mandatory for verify): The hash to verify against.

## Output Format
- **Type**: `object`
- **Description**: The output depends on the operation invoked.
- **Success Examples**:
  - **hash**: Returns `{ hash: string, salt: string }`.
  - **verify**: Returns `{ valid: true }` or `{ valid: false }`.
- **Error Example**: An error is thrown if required parameters are missing.

## Constraints
- Data must be a string.
- Hash operation requires Node.js crypto module.
- Salt should be unique for each hash operation.
