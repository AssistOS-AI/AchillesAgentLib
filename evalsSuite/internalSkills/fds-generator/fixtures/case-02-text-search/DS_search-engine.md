# DS Structure Profile

## Vision and Problem Statement
Enable keyword search across large text blocks and return matching sentences.

## Intended Users and Context of Use
Used by a text analysis tool that scans logs and reports.

## Scope and Boundaries
Only exact keyword matches, case-insensitive. No stemming or ranking.

## Success Criteria
Given input text and keywords, returns the correct sentences that contain matches.

## Pointers to Supporting DS Files
See DS_query-parser for input parsing rules.

## Affected Files
- specs/FDS_search-engine.md: Coordinates scanning and collects matching sentences.
- specs/FDS_sentence-matcher.md: Implements sentence tokenization and matching.
