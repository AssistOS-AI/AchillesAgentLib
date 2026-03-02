# DS: config-loader skill

## Vision and Problem Statement
Provide a configuration loader that parses a text request into key/value data, applies a declared type schema, and returns clear validation results. This removes ad-hoc parsing and makes config loading predictable for any caller.

## Intended Users and Context of Use
Used by any component that needs to load configuration from a single input string. The request is a single string containing one `key: value` pair per line.

## Scope and Boundaries
In scope: parsing key/value lines, JSON decoding for `source` and `schema`, type conversion, and returning validation errors. Out of scope: reading files, environment variable access, secret storage, and external configuration services.

## Success Criteria
Given the same input string, the loader returns the same config object and error list. Valid input returns an empty error list. Invalid input returns a non-empty error list with specific field errors.

## Affected Files
./specs/index.mjs.md - Implements the configuration loader and validator. Exports - action entry point that accepts a single string request payload and returns a structured validation result.
