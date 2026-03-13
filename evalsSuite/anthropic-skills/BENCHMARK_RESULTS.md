# Anthropic Skills Benchmark Results

**Date:** 2026-03-13
**Branch:** `improve-recursive-skilled-performance`
**LLM Provider:** Soul Gateway (copilot-gpt-4o via GitHub Copilot)
**Session Type:** loop (LoopAgentSession)
**Planner Mode:** plan
**Runs per case:** 3

## Architecture

Two-loop agentic execution:

```
User prompt
  → Outer LoopAgentSession (routing planner)
      → Picks skill tool, passes prompt
          → Inner LoopAgentSession (skill execution via AnthropicSkillsSubsystem)
              → Uses skill-specific tools (get-resource, run-script, bash, etc.)
              → Returns result
      → Calls final_answer with result
  → Result returned to user
```

**Direct mode** bypasses the outer routing loop — the skill is called directly via `executePrompt(task, { skillName })`.

## Summary

| Mode | Pass Rate | Total Time (48 runs) | Input Tokens | Output Tokens |
|------|-----------|---------------------|--------------|---------------|
| Direct (no routing) | **100%** (48/48) | 102.6s | 453 KB | 22.6 KB |
| Routed (top-level session) | **100%** (48/48) | 258.0s | 1.67 MB | 58.2 KB |

### Overhead

| Metric | Direct | Routed | Overhead |
|--------|--------|--------|----------|
| Avg latency per case | 2.1s | 5.4s | +2.5x |
| Avg input tokens per case | 9.4 KB | 34.8 KB | +3.7x |
| Avg output tokens per case | 470 | 1.2 KB | +2.6x |

The routing overhead is one additional LLM call (the outer planner) plus the skill description tokens in the system prompt (~5.5 KB for 8 skills).

## Per-Skill Breakdown

| Skill | Tool Used | Direct (3 runs) | Routed (3 runs) |
|-------|-----------|-----------------|-----------------|
| csv-filter | run-script | 6/6 (100%) | 6/6 (100%) |
| docx-lite | get-resource | 6/6 (100%) | 6/6 (100%) |
| json-lint | get-resource | 6/6 (100%) | 6/6 (100%) |
| meeting-notes | (none) | 6/6 (100%) | 6/6 (100%) |
| pdf-lite | get-resource | 6/6 (100%) | 6/6 (100%) |
| pptx-lite | (none) | 6/6 (100%) | 6/6 (100%) |
| text-stats | run-script | 6/6 (100%) | 6/6 (100%) |
| xlsx-lite | run-script | 6/6 (100%) | 6/6 (100%) |

## Per-Case Results — Direct Mode

All 48/48 passed.

| Case | Skill | Avg Latency | Avg Input Tok | Avg Output Tok |
|------|-------|-------------|---------------|----------------|
| pdf-check-pass | pdf-lite | 1.95s | 2691 | 91 |
| pdf-check-fail | pdf-lite | 1.88s | 2549 | 98 |
| docx-memo | docx-lite | 2.29s | 2888 | 131 |
| docx-project-plan | docx-lite | 2.19s | 2832 | 121 |
| pptx-3slides | pptx-lite | 1.19s | 1221 | 80 |
| pptx-5slides | pptx-lite | 1.67s | 1224 | 140 |
| xlsx-sum | xlsx-lite | 3.39s | 2777 | 168 |
| xlsx-sum-2 | xlsx-lite | 2.84s | 2781 | 163 |
| json-valid | json-lint | 1.87s | 2941 | 88 |
| json-invalid | json-lint | 2.02s | 2899 | 109 |
| text-stats-short | text-stats | 2.32s | 2658 | 126 |
| text-stats-article | text-stats | 2.19s | 2660 | 114 |
| meeting-standup | meeting-notes | 1.57s | 1331 | 112 |
| meeting-planning | meeting-notes | 1.51s | 1379 | 101 |
| csv-filter-70 | csv-filter | 2.58s | 2920 | 136 |
| csv-filter-90 | csv-filter | 2.75s | 2915 | 153 |

## Per-Case Results — Routed Mode

All 48/48 passed.

| Case | Skill | Avg Latency | Avg Input Tok | Avg Output Tok |
|------|-------|-------------|---------------|----------------|
| pdf-check-pass | pdf-lite | 4.76s | 9236 | 294 |
| pdf-check-fail | pdf-lite | 4.37s | 8095 | 240 |
| docx-memo | docx-lite | 5.38s | 8908 | 310 |
| docx-project-plan | docx-lite | 5.11s | 8714 | 294 |
| pptx-3slides | pptx-lite | 4.05s | 6813 | 240 |
| pptx-5slides | pptx-lite | 4.46s | 6905 | 294 |
| xlsx-sum | xlsx-lite | 5.82s | 8552 | 295 |
| xlsx-sum-2 | xlsx-lite | 5.88s | 8570 | 333 |
| json-valid | json-lint | 4.58s | 8502 | 229 |
| json-invalid | json-lint | 4.67s | 8366 | 231 |
| text-stats-short | text-stats | 5.47s | 8771 | 265 |
| text-stats-article | text-stats | 5.13s | 8237 | 254 |
| meeting-standup | meeting-notes | 4.82s | 7110 | 281 |
| meeting-planning | meeting-notes | 4.51s | 7298 | 282 |
| csv-filter-70 | csv-filter | 6.18s | 8803 | 320 |
| csv-filter-90 | csv-filter | 5.49s | 8699 | 289 |

## Bugs Found and Fixed

### Bug 1: LLM misinterprets numeric tool output as HTTP errors

**Symptom:** xlsx-sum routed mode failed ~70% of runs. The inner LLM called `run-script` which executed successfully, but then called `cannot_complete` saying "failed with a result code of 400".

**Root cause:** `sum_column.py` computed a total of 200+150+50 = **400** and printed it to stdout. The `run-script` handler returned this raw string `"400"`. The LLM interpreted `"400"` as an HTTP 400 Bad Request error rather than the numeric result.

**Fix:** Added `[ok]` / `[error]` status prefixes to `run-script` output in `buildTools.mjs`:
```javascript
// Before: return `${output.stdout || ''}${stderrText}${exitCodeText}`.trim();
// After:
if (output.exitCode) {
    return `[error] exit code ${output.exitCode}\n${stdoutText}${stderrText}`.trim();
}
return `[ok]\n${stdoutText}${stderrText}`.trim();
```

**Impact:** xlsx-sum pass rate went from ~30% to 100% in routed mode.

### Bug 2: LLM omits $$ prefix on variable references

**Symptom:** csv-filter returned literal text like `"csv-filter-res-1"` instead of the actual filtered CSV data.

**Root cause:** The LoopAgentSession planner prompt instructs the LLM to use `$$varName` syntax for variable references. But the LLM sometimes omits the `$$` prefix when calling `final_answer`, causing the literal reference string to leak through as the result.

**Fix:** Added fallback resolution in `AgenticSession.mjs` that detects bare `varName-res-N` patterns and resolves them from the `toolVars` map, even without the `$$` prefix.

### Bug 3: Outer planner rewrites prompt, losing context

**Symptom:** pdf-check and xlsx-sum failed in routed mode because the outer planner rewrote the user's detailed prompt into a simplified `toolPrompt` that dropped file paths, output format instructions, and other critical details.

**Fix:** The skill handler closure now appends the original user request to the planner's rewritten prompt:
```javascript
let fullPrompt = plannerPrompt;
if (originalTaskDescription && plannerPrompt !== originalTaskDescription) {
    fullPrompt = `${plannerPrompt}\n\nOriginal user request:\n${originalTaskDescription}`;
}
```

### Bug 4: Outer planner answers directly instead of delegating

**Symptom:** pdf-check-pass failed because the outer planner generated a checklist response itself instead of routing to the pdf-lite skill.

**Fix:** Changed the default top-level system prompt from generic "intelligent assistant" to explicit routing instruction: "You are a routing assistant. You MUST delegate every request to one of the available tools — never answer directly from your own knowledge."

### Bug 5: get-resource tool rejects natural language input

**Symptom:** json-lint failed because the inner LLM sent `"Read the content of resources/rules.md"` to the `get-resource` tool, which expected a bare file path.

**Fix:** Added natural-language prefix stripping in the `get-resource` handler:
```javascript
resourcePath = resourcePath
    .replace(/^(?:read|get|fetch|load|open)\s+(?:the\s+)?(?:content\s+of\s+)?/i, '')
    .replace(/^(?:file_path|path|file|resource)\s*[:=]\s*/i, '')
    .trim();
```

### Bug 6: Skill descriptions too verbose for routing

**Symptom:** The outer planner received the full SKILL.md body as each tool's description, wasting tokens and making routing decisions harder.

**Fix:** `parseDescriptor.mjs` now extracts the frontmatter `description` field. `SkillExecutor._buildSkillsList()` prefers this concise routing description over the full rawContent.

## Progression

| Stage | Routed Pass Rate | Key Fix |
|-------|-----------------|---------|
| Baseline (pre-redesign) | ~50% (heuristic + FlexSearch) | — |
| After top-level session | 81% (13/16 single run) | Architecture redesign |
| After fixes A-E | 96% (46/48 over 3 runs) | Prompt passthrough, resultRef fallback, system prompt |
| After run-script output fix | **100%** (48/48 over 3 runs) | `[ok]`/`[error]` prefix on tool output |

## Skills Tested

| Skill | Tool Category | Description |
|-------|---------------|-------------|
| pdf-lite | get-resource | Validates PDF text against a checklist loaded from `resources/checklist.md` |
| docx-lite | get-resource | Generates documents from templates loaded from `resources/` |
| json-lint | get-resource | Validates JSON against rules loaded from `resources/rules.md` |
| xlsx-lite | run-script | Runs `scripts/sum_column.py` to sum CSV columns |
| text-stats | run-script | Runs `scripts/text_stats.py` to compute text statistics |
| csv-filter | run-script | Runs `scripts/filter_rows.py` to filter CSV rows by threshold |
| pptx-lite | (none) | Generates slide outlines from prompt (no tools needed) |
| meeting-notes | (none) | Structures raw meeting text into formatted notes (no tools needed) |

## How to Run

```bash
# Direct mode (bypasses routing)
SOUL_GATEWAY_API_KEY=<key> node evalsSuite/anthropic-skills/evalAnthropicSkills.mjs --direct

# Routed mode (full two-loop architecture)
SOUL_GATEWAY_API_KEY=<key> node evalsSuite/anthropic-skills/evalAnthropicSkills.mjs

# Multiple runs
SOUL_GATEWAY_API_KEY=<key> node evalsSuite/anthropic-skills/evalAnthropicSkills.mjs --times 3

# Filter by skill
SOUL_GATEWAY_API_KEY=<key> node evalsSuite/anthropic-skills/evalAnthropicSkills.mjs --skill json-lint

# Debug mode (verbose output)
SOUL_GATEWAY_API_KEY=<key> node evalsSuite/anthropic-skills/evalAnthropicSkills.mjs --debug
```
