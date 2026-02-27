# DS Structure Profile

## Vision and Problem Statement
Define a simple query format for keyword searches.

## Intended Users and Context of Use
Used by CLI callers who provide queries as strings.

## Scope and Boundaries
Supports comma-separated keywords only. No boolean operators.

## Success Criteria
Consistently parses inputs into a normalized keyword list.

## Pointers to Supporting DS Files
None.

## Affected Files
- specs/FDS_query-parser.md: Parses query strings into keyword arrays.
