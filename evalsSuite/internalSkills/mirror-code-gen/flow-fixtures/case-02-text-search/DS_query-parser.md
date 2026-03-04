# DS Structure Profile

## Vision and Problem Statement
Define a simple query format for keyword searches.

## Intended Users and Context of Use
Used by CLI callers who provide queries as strings.

## Scope and Boundaries
Supports comma-separated keywords only. No boolean operators.

## Success Criteria
Consistently parses inputs into a normalized keyword list.

## Affected Files
- specs/FDS_query-parser.md - exports: parseQuery(query) : parses query string into keyword list; normalizeKeywords(keywords) : lowercases/trims keywords
