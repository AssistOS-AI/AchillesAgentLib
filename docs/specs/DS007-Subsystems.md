# DS007 — Subsystems

## Overview

Subsystems are specialized execution engines, each responsible for one type of skill. They sit between `MainAgent` and the actual skill logic, handling discovery, preparation, initialization, and execution.

## Mandatory Interface

Every subsystem must implement these methods:

| Method | Purpose |
|--------|---------|
| `parseSkillDescriptor` | Parse the skill's markdown file and return a structured descriptor. |
| `prepareSkill` | Fast, synchronous setup. Populates the skill record with metadata. Called automatically during discovery. Must not perform I/O or LLM calls. |
| `initSkill` | Async, one-time heavy initialization (e.g., code generation). Called explicitly via `MainAgent.initSkills()`. MainAgent dispatches these calls in parallel across skills and waits for all to settle. Safe to call multiple times — already-initialized skills are skipped. |
| `executeSkillPrompt` | Run the skill with the given prompt and return the result. |

## Subsystem Lifecycle

1. **Discovery** — `MainAgent` finds skill files on disk, calls `parseSkillDescriptor` and `prepareSkill` for each.
2. **Initialization** — Caller invokes `MainAgent.initSkills()` to perform expensive setup like code generation. The initialization calls are started in parallel across discovered skills, then awaited together.
3. **Execution** — Skills are run on demand via `MainAgent.executeSkill()`, which delegates to the appropriate subsystem.

## Subsystems

### CodeSkillsSubsystem (`cskill`)

Executes JavaScript/ESM modules. Skills are defined by a `cskill.md` file and implemented in `src/index.mjs`. Supports code generation from `specs/` during initialization.

### DynamicCodeGenerationSubsystem (`dynamic-code-generation`)

Runs JavaScript code dynamically — either generated at runtime by the LLM or loaded from pre-written modules. Defined by `dcgskill.md`.

### MCPSkillsSubsystem (`mcp`)

Orchestrates Model Context Protocol tools. Filters available tools by allowlist and executes them via LightSOPLang scripts or LLM-generated plans. Defined by `mskill.md`.

### OrchestratorSkillsSubsystem (`orchestrator`)

Coordinates multiple skills to accomplish complex tasks through agentic sessions (loop or SOP). Defined by `oskill.md`.

### DBTableSkillsSubsystem (`dbtable`)

Manages database table operations with LLM-powered query interpretation, validation, and confirmation flows. Defined by `tskill.md`.

### AnthropicSkillsSubsystem (`anthropic`)

Simple passthrough for basic skills — starts an agentic loop session with the skill's content as system prompt. Defined by `skill.md`.

## prepareSkill vs initSkill

| Aspect | `prepareSkill` | `initSkill` |
|--------|---------------|-------------|
| **When** | Automatically during discovery | Explicitly via `MainAgent.initSkills()` |
| **Nature** | Sync, fast | Async, potentially heavy |
| **I/O** | No | Yes |
| **LLM calls** | No | Yes |
| **Idempotent** | Yes | Yes |
