# DS: hash-util skill

## Vision and Problem Statement
Provide a secure, deterministic hashing utility that can hash and verify data without exposing low-level crypto details to callers. This enables consistent credential or token handling across skills.

## Intended Users and Context of Use
Used by internal skills and orchestration flows that need hashing or verification from a single input string. Requests are provided as a single input string containing `key: value` pairs.

## Scope and Boundaries
In scope: hashing input strings with salt, verifying hashes, and returning validation results. Out of scope: key management, encryption, or external secret storage.

## Success Criteria
Hash operations return deterministic output given the same input and salt. Verify operations return a clear valid/invalid result. Invalid inputs produce deterministic errors.

## Affected Files
./specs/index.mjs.md - Implements hashing and verification operations. Exports - action entry point for hashing and verify. Input - single string request payload.
