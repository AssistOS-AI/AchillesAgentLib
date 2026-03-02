# DS: config-loader skill

## Vision and Problem Statement
Provide a deterministic configuration loader that can parse key-value input, apply a type schema, and report validation results clearly. This allows other skills to consume configuration without ad-hoc parsing or ambiguous defaults.

## Intended Users and Context of Use
Used by internal skills and orchestration flows that need to load configuration from a single input string. Requests are provided as a single input string containing `key: value` pairs.

## Scope and Boundaries
In scope: parsing key/value input, JSON decoding for source and schema payloads, type conversion, and validation reporting. Out of scope: reading from files, secrets management, or external configuration services.

## Success Criteria
Valid configurations return a normalized config object with no errors. Invalid configurations return a normalized config object with clear validation errors. Input parsing fails deterministically on malformed data.

## Affected Files
./specs/index.mjs.md - Implements the configuration loader and validator. Exports - action entry point for loading and validating config. Input - single string request payload.
