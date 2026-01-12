# Init Project Skill Feature Plan

## Goal
Create a standalone `init-project` skill callable via the lightweight CLI that initializes a JavaScript project specification workspace by creating standard documentation folders/files and generating a `docs/specs_backlog.m` populated with LLM-driven questions (in English) based on a user-provided project prompt/blueprint.

## Scope
- Add a new skill under `spec-skills/init-project/` following the same interface as `review-specs` (`specs`, optional `roles`, `action`).
- Integrate with the existing `bin/run-skill` loader; invocation: `run init-project <targetDir> "prompt"` where `prompt` may be empty.
- Accept absolute or relative `targetDir`; normalize to absolute; behave like `review-specs` path handling; if `targetDir` does not exist, create it and print `Created directory <targetDir>` to stdout.
- Create standard directories if missing: `docs/`, `docs/specs/`, `docs/gamp`, `docs/specs/src`, `docs/specs/tests` (skip if already present).
- Generate or overwrite `docs/specs_backlog.m` using the same structure as `specs-review-skill-feature.md` (status, issues, proposed fixes) but focused on detailed questions about missing project details; content is English-only.
- Create `docs/docs_backlog` with static placeholder content: `Here will be backlog for docs`.
- No other files are modified; implementation will be added later.

## Deliverables
- `spec-skills/init-project/init-project.mjs` exporting `specs`, optional `roles`, and `action`.
- `spec-skills/init-project/skill.md` (optional descriptor for documentation).
- `spec-skills/init-project/init-project-feature.md` (this plan file).
- Updates to `bin/run-skill` to parse `init-project` arguments (`targetDir`, optional prompt).
- Generated files in target projects: `docs/specs_backlog.m` (LLM questions) and `docs/docs_backlog` (static stub) when the skill runs.

## CLI Design (`bin/run-skill`)
- Usage: `run <skill-name> [params...]`.
- For `init-project`: `run init-project <targetDir> "prompt"` (prompt optional/empty).
- Behavior: resolve repo root (current working dir), load `spec-skills/<skill-name>/<skill-name>.mjs`, invoke `action(parsedArgs, context)`.
- Outputs: concise status line to stdout; error line to stderr; exit non-zero on fatal errors.
- No use of `RecursiveSkilledAgent` or `.AchillesSkills`.

## Skill Layout (`spec-skills/init-project/`)
- `init-project.mjs` exports:
  - `specs`: metadata (name, description, arguments, example usage).
  - `roles`: optional array (likely omitted).
  - `action(args, context)`:
    - `args.targetDir` (string, required).
    - `args.prompt` (string, optional; may be empty).
- `skill.md`: human-readable descriptor (title, summary, usage) for documentation (not required by loader).

## Directory & File Creation
- Normalize `targetDir` to absolute (accept relative paths); create `targetDir` if it does not exist and announce with `Created directory <targetDir>`.
- Ensure directories exist (create if missing, skip if present):
  - `docs/`
  - `docs/specs/`
  - `docs/gamp`
  - `docs/specs/src`
  - `docs/specs/tests`
- Do not modify existing directories if already present; creation is idempotent.

## Backlog Files
- `docs/specs_backlog.m`:
  - Overwrite on each run with fresh LLM-generated content.
  - Structure identical to `specs-review-skill-feature.md` format: per-section heading and bullets for `Status`, `Issues`, `Proposed fixes`.
  - Content purpose: ask detailed questions about the project based on the user prompt/blueprint; focus on gaps/missing details, not generating new ideas autonomously; English only.
- `docs/docs_backlog`:
  - Create if missing; write static placeholder: `Here will be backlog for docs`.

## LLM Prompting (for `specs_backlog` content)
- Persona: expert project manager/specification auditor.
- Inputs: user `prompt`/blueprint describing the desired project; ask the model to generate targeted questions about missing or ambiguous requirements needed for a coherent spec.
- Output schema (mirrors review-specs backlog):
  - One main section (e.g., `## project-questions`) or structured sections as designed during implementation.
  - Bullets:
    - `- Status: needs-info` (expected)
    - `- Issues:` list of questions/gaps
    - `- Proposed fixes:` suggested info the user should provide (phrased as prompts for user input)
- If prompt is empty, fall back to a generic question set for a JS project.

## Processing Flow in `action`
1. Parse args; validate presence of `targetDir`; allow empty `prompt`.
2. Resolve `targetDir` to absolute; create it if missing (and announce); error if path invalid/unreadable.
3. Create required directories if missing; skip existing.
4. Build LLM prompt from user `prompt` and goals; call LLM to produce backlog content (questions) in the required schema.
5. Write (overwrite) `docs/specs_backlog.m` with generated content.
6. Create `docs/docs_backlog` with static text if missing (or overwrite with same static text if desired for determinism).
7. Print concise status to stdout; set non-zero exit on fatal errors.

## Error Handling
- Missing `targetDir` -> error + exit non-zero.
- Non-existent `targetDir` -> create it and announce `Created directory <targetDir>`; if creation fails, error + exit non-zero.
- Directory creation failures (subfolders) -> error + exit non-zero.
- LLM failure -> error + exit non-zero (may choose to write a stub backlog noting the failure, decided during implementation).

## Testing / Manual Verification
- Automated smoke test: `evalsSuite/spec-skills/init-project.test.mjs` (executes CLI; uses whatever LLM configuration is available) runs the CLI and asserts directories/files are created and backlog contents exist.
- Create a temp project dir; run `./bin/run-skill init-project . "ToDo app with auth"`.
- Verify directories created as listed.
- Verify `docs/specs_backlog.m` is overwritten and contains English questions with Status/Issues/Proposed fixes format.
- Verify `docs/docs_backlog` contains the static stub text.
- Confirm idempotent reruns do not duplicate directories and always refresh `specs_backlog.m`.

## Out of Scope
- Implementing actual spec files or code scaffolding beyond the backlog files.
- Integrating with `RecursiveSkilledAgent` or `.AchillesSkills` discovery.
- Auto-generating feature ideas beyond asking for missing info.

## Status Enum (for backlog entries)
- `ok`: spec appears consistent and complete (unlikely for questions mode).
- `needs-info`: missing details; expected default for questions.
- `broken`: major contradictions (probably unused here unless prompt is malformed).

## Example Backlog Entry
```
## project-questions
- Status: needs-info
- Issues:
  - What core user roles and permissions are required?
  - What are the primary user flows and success criteria?
  - What integrations or external services must be supported (auth, billing, notifications)?
  - What non-functional requirements apply (performance targets, availability, compliance)?
- Proposed fixes:
  - Provide detailed user role matrix and access rules.
  - Describe main flows (e.g., signup/login/reset, create/edit/delete items) with edge cases.
  - List third-party services/APIs and required interactions.
  - Specify SLAs, performance budgets, and compliance constraints.
```
