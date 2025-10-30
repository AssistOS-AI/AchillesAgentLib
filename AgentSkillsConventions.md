# Agent Skills Conventions

This document captures the conventions we are applying while building the new interactive skill
format for Achilles agents. It acts as the authoritative reference for repository structure,
skill metadata, and entrypoints.

## Repository Layout

- Each test or integration scenario owns its own skill repository.
- Skill repositories live underneath a `.AchillesSkills/` directory placed at the root of the
  scenario (e.g. `tests/iskills/<scenario>/.AchillesSkills/<repo>/<skill>/`).
- A skill folder name acts as the skill's short name. When a JavaScript entrypoint is present it
  should use the same short name, for example `deploy_update/deploy_update.js`.
- Additional resources (fixtures, data files, etc.) required by the skill live alongside the skill
  folder.

## Skill Descriptors

Each skill folder may include one or more descriptor files depending on the type of the skill. The
interactive skills introduced in this iteration use `iskill.md` for their canonical description.

Descriptor expectations:

- The markdown file should capture the business context, required inputs, optional inputs, and any
  execution notes.
- The first heading inside the file becomes the human-readable title displayed in tooling.
- New skill types expand the descriptor catalogue:
  - `mskill.md` — metadata for MCP orchestration skills. Sections such as **Instructions** describe
    the system prompt, while **Allowed Tools** can list a constrained set of MCP tools that the
    subsystem may invoke.
  - `oskill.md` — metadata for orchestration skills. The **Instructions** section guides planning,
    **Allowed Skills** can limit which skills the orchestrator may call, and **Intents** declares the
    intent taxonomy that should be considered during planning.
  - Orchestration descriptors may optionally provide a **Fallback** section. When present, the agent
    is authorised to invent an ad-hoc MCP plan using the supplied ReAct-style instructions and the
    optional fallback tool allow-list whenever no predefined skill fits the request.

## Entrypoints

- Interactive skills can provide an optional JavaScript entrypoint named after the skill's short
  name (`<skill_short_name>.js`).
- The module should export:
  - `specs`: the structured skill definition consumed by the skill registry.
  - `roles`: an array describing allowed roles.
  - `action`: the function that executes the skill. Tests may use simple stubs that echo the
    collected arguments.
- Entrypoints can also expose optional helpers (e.g. `configure`) when a scenario needs additional
  setup.

## Execution API Expectations

- Tests and integrations exercise skills via `RecursiveSkilledAgent.executePrompt(promptText, options)`.
- Each subsystem exposes a `prepareSkill(skillRecord)` hook (invoked during discovery) and a
  single `executeSkillPrompt({ skillRecord, recursiveAgent, promptText, options })` entry point.
  `recursiveAgent` supplies shared services such as the configured `LLMAgent` and request
  `promptReader`.
- The helper harness (`tests/iskills/helpers/runInteractiveSkillScenario.mjs`) initialises a real
  `LLMAgent`. When credentials are missing the tests are skipped rather than mocked.
- `RecursiveSkilledAgent` now understands orchestration and MCP skills:
  - When `executePrompt` is called without an explicit `skillName`, the agent first searches for an
    orchestrator skill using a FlexSearch heuristic. If a match is found the corresponding
    `OrchestratorSkillsSubsystem` instance plans and executes downstream skills.
  - If no orchestrator applies, the agent falls back to an LLM-driven (or heuristic) chooser that
    selects the most appropriate skill from the global catalogue.
  - Orchestration skills can recursively invoke `executePrompt`, but they must always specify the
    concrete `skillName` when delegating. Indirect recursive calls without a target skill are
    rejected.
  - MCP skills transform their descriptor instructions into MCP tool plans. An optional allowed-tool
    list constrains execution even when the runtime advertises additional tools.

## Future Work

- The `MemoryContainer` (formerly `ContextManager`) expects new APIs to accept a
  `session-memory` entry within their options.
- Additional skill subsystems (Claude, MCP, Code Calling, Orchestrator) now share the same
  `executeSkillPrompt` shape; reusable helpers can graduate into a `skills/helpers/` folder when
  patterns emerge.

This document will be updated as conventions solidify.
