# reverse-specs

Synchronise URS/FS/NFS/DS documents with the current workspace by analysing code files that are not ignored.

## Summary
- Reads `.specs/.ignore` before scanning the project.
- Creates or updates auto-generated URS/FS/DS entries when new files are detected.
- Describes each file at the DS level so rebuild and traceability steps remain deterministic.

## Instructions
- Always refresh the ignore list (by calling the ignore-files skill implicitly when needed).
- Limit scanning to text-based project sources (js/mjs/ts/tsx/json/html/css/markdown/configs).
- Produce a human-readable summary of changes applied to the specs.
