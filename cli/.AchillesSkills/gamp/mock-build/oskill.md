# mock-build

Summarise the latest GAMP specifications (URS, FS, NFS, DS) and publish human-readable HTML artefacts.

## Summary
- Reads all specification documents and design files to extract identifiers, traceability, and file impacts.
- Generates `.specs/mock/spec-summary.html` plus the full `.specs/html_docs` site so operators can review specs visually.
- Returns structured JSON so the CLI can echo the most important details inline.

## Instructions
- Group information by doc type, preserving IDs and titles exactly as written.
- In DS summaries, list every impacted file with its rationale (why/how/what) and the semantic expectations.
- Include up to 3 tests per DS in the summary, mirroring the sections in the DS document.
- Always regenerate HTML docs via `GampRSP.generateHtmlDocs()` so downstream tools stay in sync.
