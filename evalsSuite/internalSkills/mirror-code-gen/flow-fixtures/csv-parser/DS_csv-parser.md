# DS: csv-parser skill

## Vision and Problem Statement
Provide a predictable CSV parsing and transformation tool that can convert CSV input into structured data and apply simple mapping/filtering rules. This prevents bespoke CSV handling across skills and ensures consistent parsing behavior.

## Intended Users and Context of Use
Used by internal skills and orchestration flows that need to parse CSV content from a single input string. Requests are provided as a single input string containing `key: value` pairs.

## Scope and Boundaries
In scope: parsing CSV strings, mapping field names, filtering rows, and returning structured output. Out of scope: file I/O, streaming large datasets, or complex CSV dialects beyond basic delimiters/quotes.

## Success Criteria
Valid CSV input is parsed deterministically with consistent row/column output. Transformations apply predictable filters/mappings and return expected results. Malformed input returns clear errors.

## Affected Files
./specs/index.mjs.md - Implements CSV parsing and transformation operations. Exports - action entry point for parsing and transforming CSV input. Input - single string request payload.
