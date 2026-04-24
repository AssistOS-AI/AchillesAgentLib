# DS006 — CodeSkillsSubsystem

## Overview

The `CodeSkillsSubsystem` manages **code skills** (cskills) — JavaScript/ESM modules that execute user-defined logic. Code skills are defined by a `cskill.md` descriptor file and implemented in `src/index.mjs` (or `src/index.js`). The subsystem handles **lazy code generation**: when a skill has a `specs/` directory but no generated code, it automatically invokes `mirror-code-generator` on first execution.

## Architecture

```
CodeSkillsSubsystem
├── parseSkillDescriptor()    → parse cskill.md via skillDocumentParser
├── prepareSkill()            → detect specs/ presence, flag needsGeneration (async, non-blocking)
├── executeSkillPrompt()      → ensure code exists, then execute from disk
├── _ensureCodeGenerated()    → lazy generation with dedup lock
├── executeCodeFromDisk()     → dynamic import + module.action(args)
├── getSpecifications()       → extract skill sections as camelCase config
└── extractArguments()        → LLM-based argument extraction (legacy)
```

## Lifecycle

### 1. Discovery (`MainAgent._registerSkill`)

```
MainAgent discovers cskill.md
  → subsystem.parseSkillDescriptor()
  → subsystem.prepareSkill(skillRecord)     // non-blocking
```

### 2. Preparation (`prepareSkill`)

Sets `skillRecord.preparedConfig` with:
- `hasSpecs` — whether `specs/` directory exists
- `needsGeneration` — whether `specs/` exists but `src/index.mjs`/`src/index.js` does not

This check runs **asynchronously** (fire-and-forget) so it does not block skill discovery.

### 3. Execution (`executeSkillPrompt`)

```
executeSkillPrompt({ skillRecord, mainAgent, promptText, options })
  → _ensureCodeGenerated(skillRecord, mainAgent)
      → if src/index.mjs exists: return immediately
      → if specs/ exists but no code: await mainAgent.executeSkill('mirror-code-generator', skillDir)
      → if neither: throw error
  → executeCodeFromDisk(skillDir, args)
      → dynamic import src/index.mjs
      → call module.action(args)
```

### 4. Lazy Code Generation

- **Triggered on first execution** when `specs/` exists but `src/index.mjs` does not.
- Uses `mainAgent.executeSkill('mirror-code-generator', skillDir)` to generate code.
- **Deduplication**: concurrent executions of the same skill share a single generation promise via `_generating` Map.
- **Non-blocking discovery**: skill registration completes before generation starts.

## Context Passed to Skills

Skills receive a `context` object via `module.action(context)`:

| Field | Type | Source |
|-------|------|--------|
| `promptText` | `string` | User prompt |
| `llmAgent` | `LLMAgent` | Subsystem's LLM agent |
| `context` | `object` | `options.context` from caller |
| `user` | `object` | `options.context.user` |
| `attachments` | `array` | `options.context.attachments` |

**Important**: `mainAgent` is **never** passed to skills. Skills access LLM capabilities through `context.llmAgent` and model configuration through `context.llmAgent.modelConfig`.

## Error Handling

| Scenario | Error Message |
|----------|--------------|
| Missing `Input Format` section | `Invalid/unprepared cskill: Missing 'Input Format' section...` |
| No code and no specs/ | `Execution failed: No valid entrypoint found and no specs/ directory...` |
| No entrypoint after generation | `Execution failed: No valid entrypoint found...` |
| Module missing `action` export | `Execution failed: Module '...' does not export an 'action' function.` |
| Generation failure | Propagated from `mirror-code-generator` skill |

## Configuration

```javascript
const subsystem = new CodeSkillsSubsystem({
  llmAgent,           // Required: LLMAgent instance
  modelConfig,        // Optional: { plan: 'plan', code: 'code' }
});
```

## Skill Definition (cskill.md)

```markdown
# My Code Skill

Description of what this skill does.

## Input Format
Description of expected input structure.

## Output Format
Description of what the skill returns.

## Constraints
Any constraints or requirements.
```

## Code Generation (specs/)

When a `specs/` directory exists with `.md` or `.mds` specification files, the subsystem auto-generates `src/index.mjs` on first execution via `mirror-code-generator`. The generated code implements the `action(context)` function based on the spec definitions.

**Do not edit `src/index.mjs` directly** — modify specs and the code will be regenerated on next execution.
