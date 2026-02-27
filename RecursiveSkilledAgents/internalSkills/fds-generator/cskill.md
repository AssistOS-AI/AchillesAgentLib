# fds-generator

## Summary
Generates File Design Specifications (FDS) under `specs/` based on DS files (`DS*.md`). It scans the target directory for DS files, reads the Affected Files section, and regenerates FDS files when DS inputs are newer or missing.

## Input Format
- **prompt** (string): Absolute or relative path to the target directory.

Rules:
- DS files are discovered in the target root, `docs/`, and `docs/specs/` (recursive).
- Affected files are resolved relative to the target directory.

Examples:
- "./skills/inventory"
- "/path/to/project"

## Output Format
- **Type**: `object`
- **Success Example**:
  ```json
  {
    "message": "FDS generation completed for ./skills/inventory",
    "generatedFiles": ["specs/FDS_inventory.md"],
    "regenerated": true
  }
  ```
- **Skipped Example**:
  ```json
  {
    "message": "FDS up-to-date for ./skills/inventory",
    "skipped": true,
    "generatedFiles": [],
    "regenerated": false
  }
  ```

## Constraints
- Only files matching `DS*.md` are considered.
- Regeneration is forward-only (DS -> FDS); if FDS is newer, it is not regenerated.
