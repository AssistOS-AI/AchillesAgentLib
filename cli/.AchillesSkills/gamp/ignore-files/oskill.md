# ignore-files

Maintain the `.specs/.ignore` manifest that keeps specification operations focused on relevant source files.

## Summary
- Detects file and folder names referenced in the prompt.
- Adds default Node.js artefacts (`node_modules`, `dist`, etc.) when requested.
- Writes the combined list to `.specs/.ignore`.

## Instructions
- Parse newline or comma-separated lists of directories.
- Avoid duplicates and keep entries normalised relative to the workspace root.
- Return the updated ignore list for visibility.
