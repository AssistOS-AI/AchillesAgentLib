# DS: hash-util skill

## Vision and Problem Statement
Provide a hashing utility that can hash and verify input data without exposing low-level crypto details. This enables consistent handling of hashed data across components.

## Intended Users and Context of Use
Used by any component that needs hashing or verification from a single input string. The request is a single string containing one `key: value` pair per line.

## Scope and Boundaries
In scope: hashing input strings with salt, verifying hashes, and returning verification results. Out of scope: key management, encryption, and external secret storage.

## Success Criteria
Given the same input and salt, hashing returns the same hash. Verification returns a clear valid/invalid boolean. Invalid input returns a clear error message.

## Affected Files
./specs/index.mjs.md - Implements hashing and verification operations. Exports - action entry point that accepts a single string request payload and returns hash or verification results.
