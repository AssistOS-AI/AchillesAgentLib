# build-code

Regenerate code artefacts described in DS files, using file-level impact metadata to avoid unnecessary rewrites.

## Summary
- Parses each DS for `### File:` sections.
- Ensures the referenced files exist and contain a generated banner tying them to the DS entry.
- Updates timestamps only when the specification has changed.

## Instructions
- Never overwrite manual code if the file already contains the correct DS banner.
- Create parent directories as needed.
- Return a manifest of files touched versus skipped.
