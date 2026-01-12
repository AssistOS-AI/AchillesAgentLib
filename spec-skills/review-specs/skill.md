# Review Specs Skill

## Summary
Reviews JS specification markdown files (.js.md co-located or specs/ mirror) against their JS sources and updates `specs_backlog.md` with status, issues, and proposed fixes.

## Usage
- CLI: `run review-specs <targetDir>`
- Example: `run review-specs .`

## Behavior
- Scans `<targetDir>` for:
  - Co-located `**/*.js.md` with sibling `.js`.
  - Mirrored `specs/**/*.md` mapped to `<targetDir>/<relative-without-specs-prefix>`.
- Calls LLM to assess completeness/consistency using full spec and code content.
- Writes/updates `<targetDir>/specs_backlog.md` with one section per spec, sorted by path.
- Summary line to stdout:
  - Success: `review-specs: processed <N> specs, wrote specs_backlog.md`
  - No specs: `review-specs: no specs found (see specs_backlog.md)`
  - Error: `review-specs: error - <message>`

## Arguments
- `targetDir` (required): directory to scan; absolute or relative to current working directory.

## Notes
- Does not use RecursiveSkilledAgent or .AchillesSkills; loads module directly.
- LLM errors are surfaced by the caller and marked in the backlog as needs-info.
- If no specs are found, writes `# specs_backlog` and `- Note: no spec files found` and exits with success.
