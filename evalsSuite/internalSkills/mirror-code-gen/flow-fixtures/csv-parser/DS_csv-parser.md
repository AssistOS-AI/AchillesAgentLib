# DS: csv-parser skill

## Vision and Problem Statement
Provide a CSV parser that converts CSV text into structured rows and can apply simple mapping and filtering rules. This replaces ad-hoc CSV handling and keeps parsing behavior consistent.

## Intended Users and Context of Use
Used by any component that needs to parse CSV content from a single input string. The request is a single string containing one `key: value` pair per line.

## Scope and Boundaries
In scope: parsing CSV strings, mapping field names, filtering rows, and returning structured output. Out of scope: file I/O, streaming large datasets, and CSV dialects beyond basic delimiters and quotes.

## Success Criteria
Given the same input string, parsing returns the same row/column output. Transformations apply the specified mappings and filters exactly. Malformed CSV returns a clear error message.

## Affected Files
./specs/index.mjs.md - Implements CSV parsing and transformation operations. Exports - action entry point that accepts a single string request payload and returns structured parse/transform results.
