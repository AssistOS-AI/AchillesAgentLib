# Specs Review Skill Feature Plan

## Goal
Create a generic skill callable directly via a lightweight CLI (no RecursiveSkilledAgent) that reviews specification markdown files for JS sources, reports issues, and updates/creates a `specs_backlog.md` in a target directory.

## Scope
- Implement a small CLI command `run <skill-name> <params...>` (e.g., `run review-specs /path/to/project`).
- Implement a standalone skill `review-specs` under `spec-skills/review-specs/` following the skill interface (`specs`, optional `roles`, `action`).
- Support two spec layouts: co-located `.js.md` next to `.js` and mirrored `specs/` directory with same structure as code tree.
- Generate/update `docs/specs_backlog.md` in the target directory; no other output except a brief terminal summary.
- Use LLM prompt (expert project manager) to assess spec completeness/consistency vs code and propose fixes. Prompts live in `spec-skills/review-specs/prompts.mjs`.

## Deliverables
- `bin/run-skill` (or similarly named) CLI that resolves `spec-skills/<skill-name>/<skill-name>.mjs` and calls `action` with parsed args.
- `spec-skills/review-specs/review-specs.mjs` exporting `specs`, optional `roles`, and `action` (prompts sourced from `prompts.mjs`).
- `spec-skills/review-specs/skill.md` (optional descriptor for docs; loader does not require it).
- `specs_backlog.md` produced/updated in the user-specified target directory when CLI runs.
- Documentation in `specs-review-skill-feature.md` (this file) describing behavior and formats.

## CLI Design (`bin/run-skill`)
- Usage: `run <skill-name> [params...]`.
- Behavior: resolve repo root (current working dir), load `spec-skills/<skill-name>/<skill-name>.mjs`, and invoke `action(parsedArgs, context)`.
- Arg parsing (minimal):
  - First positional after skill name for `review-specs` = `targetDir`.
- Outputs: success/fail line to stdout; detailed content only in backlog file. Suggested format:
  - Success: `review-specs: processed <N> specs, wrote docs/specs_backlog.md`
  - No specs: `review-specs: no specs found (see docs/specs_backlog.md)`
  - Error: `review-specs: error - <message>`
- No use of `RecursiveSkilledAgent` or `.AchillesSkills`; direct module load (direct LLMAgent usage allowed).

## Skill Layout (`spec-skills/review-specs/`)
- `review-specs.mjs` exports:
- `specs`: metadata object (name, description, arguments schema, example usage).
- `roles`: optional array (leave empty/omit).
- `action(args, context)`:
  - `args.targetDir` (string, required).

- `skill.md`: human-readable descriptor (title, summary, usage, options), not required by loader.

## Discovery Logic for Specs
- Target directory = user-supplied path (absolute or relative to cwd; normalize to absolute).
- Collect candidate files:
  1. Co-located pattern: find `**/*.js.md` under targetDir; associate with sibling `*.js` if exists.
  2. Mirrored `specs/` pattern: if `specs/` exists under targetDir, find `specs/**/*.md` where the corresponding code path is `targetDir/<relative-without-specs-prefix>` (strip `specs/` and drop `.md` extension).
- Only process entries where at least the `.md` exists; `.js` is optional but preferred. Record when `.js` is missing.
- Use a relative path (from targetDir) as the section key in backlog.

## Backlog File Format (`specs_backlog.md`)
- Create or update in `targetDir/docs/specs_backlog.md`.
- One section per spec file:
  - Heading: `## <relative-md-path>` (e.g., `src/auth/index.js.md` or `specs/auth/index.js.md`).
  - Lines:
    - `- Status: ok | needs-info | broken`
    - `- Issues:` list bullets (or `- Issues: none` when ok)
    - `- Proposed fixes:` list bullets (or `- Proposed fixes: none` when ok)
- Preserve/merge: if section exists, replace its contents with the new evaluation for that file.
- Order: sorted by relative path for determinism.

## LLM Prompt (per spec)
- System/role idea: "You are an expert project manager and specification auditor. Review JS specs for completeness and consistency."
- Include in prompt (see `prompts.mjs`):
   - The spec markdown content.
   - If available, the JS source content (full content, no truncation).
   - Checklist:
     - Purpose and scope clearly stated.
     - Inputs/outputs, parameters, return types documented.
     - Control flow and edge cases (errors, null/undefined, empty states) covered.
     - Dependencies and side effects noted.
     - Consistency between spec and code (naming, behavior, exported functions).
     - Missing details or contradictions.
   - Ask for structured JSON-ish result with `status`, `issues[]`, `proposedFixes[]` using status enum `ok|needs-info|broken`.
- (LLM errors handled by caller; no special fallback here.)

## Processing Flow in `action`
1. Parse args and resolve paths.
2. Discover spec/code pairs (co-located and mirrored).
3. For each spec:
   - Read spec MD (required) and JS (if present).
   - Build prompt and call LLM.
   - Normalize response to the backlog schema.
4. Read existing `specs_backlog.md` if present, update/replace sections for processed specs; leave other sections intact.
5. Write updated backlog.
6. Exit with non-zero code if fatal errors (e.g., targetDir missing, unreadable files).

## Error Handling
- Missing targetDir -> error + exit non-zero.
- No specs found -> write `specs_backlog.md` with `# specs_backlog` and `- Note: no spec files found`; exit 0 but print warning summary line.
- Per-file read errors -> mark that file with `needs-info`, issue describing the read failure.
- LLM failure -> `needs-info` with issue containing the error message summary (error propagation from caller).

## Testing / Manual Verification
- Create a temp fixture with:
  - Co-located `foo.js` + `foo.js.md`.
  - Mirrored `specs/bar/baz.js.md` with `bar/baz.js`.
- Run: `./bin/run-skill review-specs .` and inspect `specs_backlog.md` for both entries.

## Out of Scope
- Applying fixes to specs (future skill).
- RecursiveSkilledAgent integration or `.AchillesSkills` discovery.
- Non-JS file types (currently only `.js` + `.js.md`).

## Status Enum
- `ok`: spec appears consistent and complete.
- `needs-info`: missing details, minor gaps, or missing LLM.
- `broken`: contradictions or major incompleteness.

## Example Backlog Entry
```
## src/auth/login.js.md
- Status: needs-info
- Issues:
  - Spec omits error handling for invalid credentials.
  - Does not describe rate-limiting behavior present in code.
- Proposed fixes:
  - Document error response structure and codes.
  - Add section on throttling logic and edge cases.
```
