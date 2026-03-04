# DS Structure Profile

## Vision and Problem Statement
Enable keyword search across large text blocks and return matching sentences.

## Intended Users and Context of Use
Used by a text analysis tool that scans logs and reports.

## Scope and Boundaries
Only exact keyword matches, case-insensitive. No stemming or ranking.

## Success Criteria
Given input text and keywords, returns the correct sentences that contain matches.

## Affected Files
- specs/FDS_search-engine.md - exports: searchSentences(text, keywords) : returns matching sentences; buildSearchReport(text, keywords) : returns match summary
- specs/FDS_sentence-matcher.md - exports: splitSentences(text) : splits text into sentences; sentenceHasKeyword(sentence, keywords) : checks matches
