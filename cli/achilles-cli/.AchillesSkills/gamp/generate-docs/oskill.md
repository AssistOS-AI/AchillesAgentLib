# generate-docs

Publish HTML documentation under `.specs/html_docs` based on the current specifications.

## Summary
- Converts URS/FS/NFS and DS files to simple static HTML pages.
- Keeps styling lightweight so docs remain diff-friendly.
- Returns the output directory for toolchains that host or archive the docs.

## Instructions
- Always overwrite existing files to keep docs consistent.
- Ensure the operation is idempotent.
- Report the number of HTML files emitted.
