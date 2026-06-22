# DS005 - Agentic Session (LoopAgentSession)

## Purpose

LoopAgentSession implements a bounded multi-step execution model where an LLM planner decides which tool to call at each step, and the session executes tools until a final answer is reached or limits are hit.

## Session Lifecycle

```
new LoopAgentSession({ agent, tools, options })
    │
    ▼
Status: idle
    │
    ▼
session.newPrompt(userPrompt)
    │
    ▼
Status: running
    │
    ▼
Loop (up to maxStepsPerTurn):
    1. Request planner decision
    2. Check supervisor approval
    3. Execute tool
    4. Evaluate result
    │
    ▼
Status: done | failed | awaiting_input
```

## Constructor Behavior

**Required parameters:**
- `agent` — LLMAgent instance
- `tools` — object mapping tool names to handler functions

**Optional parameters (via options):**
- `maxStepsPerTurn` — maximum tool calls per prompt (default: 8)
- `maxErrors` — maximum errors before aborting (default: 5)
- `model` — model to use for planner decisions (default: "plan")
- `maxRetriesPerTurn` — retry count for validation failures (default: 3)
- `systemPrompt` — system prompt for the session
- `preparation` — preparation configuration for context building
- `historyCompressionEnabled` — enables automatic history compression (default: true)
- `historyCompressionThresholdTokens` — estimated token threshold that triggers compression (default: 6000)
- `historyCompressionKeepRecentEntries` — number of latest history entries preserved verbatim (default: 8)
- `historyCompressionMaxSummaryTokens` — target summary size for compression prompt (default: 1200)
- `historyCompressionModel` — optional model override for compression (defaults to planner model)
- `supervisor` — tool approval controller
- `signal` — AbortSignal forwarded to planner/model calls for cancellation

**What happens on construction:**
1. Validates agent and tools are provided
2. Validates tool names do not conflict with reserved names
3. Adds reserved tools (final_answer, cannot_complete) to tool set
4. Configures execution limits from options
5. Stores supervisor if provided
6. Initializes empty turns, history, and tool calls tracking
7. Sets status to idle

## Tool Execution with Supervisor

Before executing any tool, the session checks with the supervisor if one is configured.

**Approval flow:**
```
_executeTool(toolName, prompt)
    │
    ▼
Check alwaysApprove cache for this tool
    │
    ├─► [cached] → execute directly
    │
    └─► [not cached]
        │
        ▼
        supervisor.approve({ toolName, prompt })
        │
        ├─► 'approve' → execute tool
        ├─► 'alwaysApprove' → execute tool + cache approval
        └─► 'deny' → return error JSON to planner
```

The alwaysApprove cache is stored in a Map keyed by `alwaysApprove:toolName`. Once a tool is marked as always approved, subsequent calls skip the supervisor check.

When denied, the session returns a structured error JSON to the planner rather than throwing, allowing the planner to choose an alternative tool.

## Planner Decision Loop

Each step in the loop:

1. **Request decision** — builds a planner prompt with available tools, history, and current user prompt. LLM returns markdown with `tool`, `prompt`, and `reason` sections, which the runtime parses into the planner decision object.

2. **Execute tool** — resolves tool variables in the prompt, checks supervisor approval, calls the tool handler.

3. **Evaluate result:**
   - `__finalAnswer` → session ends with done status
   - `__cannotComplete` → session ends with failed status
   - `requiresConfirmation` or `requiresInput` → session pauses with awaiting_input status
   - `success: true` with records/message → returns as final answer
   - `success: false` → returns as failed answer
   - Otherwise → continue to next step

4. **Loop detection** — if the same tool with the same prompt returns the same result three times, the session terminates with the last result.

5. **Error handling** — tool errors increment an error counter. If maxErrors is reached, the session aborts.

## Session Statuses

| Status | Meaning |
|--------|---------|
| idle | Session created, no prompt processed yet |
| running | Currently processing a prompt |
| active | Session has completed at least one turn successfully |
| awaiting_input | Session is waiting for user input (interactive tool) |
| interrupted | Session was cancelled and recorded interruption context |
| done | Session completed successfully |
| failed | Session failed due to errors, validation, or cannot_complete |

## Cancellation and Interrupt Recovery

Loop sessions support cooperative cancellation through `AbortSignal` and explicit `cancel(reason)` calls.

- During `newPrompt()`, the runtime creates an internal prompt-scoped abort controller and links it with the external signal.
- Planner, intent-interpretation, and history-compression LLM calls receive the active abort signal.
- On cancellation, the session transitions to `interrupted`, stores a system history event containing reason and timestamp, and returns `Interrupted: <reason>` as the turn result.
- A later user prompt automatically exits `interrupted` status and resumes normal loop execution.

Skill execution may not always be instantly interruptible at subsystem level; in those cases, cancellation is honored at the next safe boundary after the running skill call completes.

## History and Tracking

The session maintains three distinct tracking structures, each with a specific role:

- **history** — chronological log of user prompts, tool calls, and session events. Each entry has a `type` (`user`, `tool_call`, `tool`, `awaiting_input`, `final_answer`, `cannot_complete`, `validation_failed`, `timeout`, `history_summary`). For `tool` entries, `resultRef` identifies the result stored in `toolVars`. This is the primary context source for the planner prompt.
- **toolCalls** — flat list of all tool invocations with metadata (`tool`, `prompt`, `resultRef`). Used to quickly identify the most recent tool call for planner context. Does not store the result value itself.
- **toolVars** — Map of `resultRef` to the actual tool result value. Single source of truth for tool outputs. Referenced by history entries and resolved via `$$resultRef` syntax in subsequent prompts.

**turns** — array of turn objects, each containing steps, final answer, and status (used for execution tracking, not context building).

Tool results are stored in `toolVars` with auto-generated references (e.g., `toolName-res-1`) that can be referenced in subsequent prompts using `$$variableName` syntax.

LoopAgentSession exposes `getConversationSnapshot()` for delegated skill execution. The snapshot contains `history`, `status`, and `lastAnswer`, and is cloned so downstream consumers cannot mutate the live session state. Tool result payloads are not included in the snapshot; tool call records remain available through `history`, while the separate internal `toolCalls` index is not included.

## Preparation

If a preparation configuration is provided, the session runs a preparation sub-session before processing the main prompt. The preparation executes tools to build context, and the resulting context variables are injected into both the system prompt and the user prompt.

For orchestrator sub-sessions, parent MainAgent context and preparation context are separate concepts. The parent snapshot may be passed internally through `options.parentContext`, but it is not injected wholesale into the sub-session prompt. If the orchestrator has explicit preparation and the parent snapshot exists, preparation can use the internal `clarify_context` tool/command to ask targeted questions that are answered only from that parent snapshot. Only the resulting preparation output is injected into the sub-session prompts.

## Pending Input Handling

When a session is in awaiting_input status, the next `newPrompt` call checks the history for the pending tool. If the user's input is not a fresh instruction for a different tool, the session routes the input to the pending tool rather than triggering a new planner decision.

## History Compression

Before each new turn, the session can compress old history when the estimated history token volume passes `historyCompressionThresholdTokens`.

Compression behavior:
- Builds a prompt with the history entries to compress and resolved `resultRef` values from `toolVars`.
- Expects markdown with `summary` and `keepResultRefs` sections.
- Replaces old history with one `history_summary` entry.
- Preserves the latest `historyCompressionKeepRecentEntries` items as-is (default: 8).
- Prunes `toolVars` and `toolCalls` entries not referenced by `keepResultRefs` or by recent history.
- Skips compression when a tool is pending in `awaiting_input` to avoid breaking interactive continuation.
- If compression returns invalid markdown or empty summary, the session continues without mutating history (fail-open).

## What LoopAgentSession Does NOT Do

- Does NOT discover or register skills
- Does NOT resolve model selection (uses model from options, resolved by LLMAgent)
- Does NOT manage session persistence (handled by MainAgent's session map)
- Does NOT perform supervisor checks for built-in tools (final_answer, cannot_complete)
- Does NOT retry failed tool calls (planner decides next action)

## Testable Functionality

Test files should be created in tests/mainAgent/ or tests/agenticSessions/

**LoopAgentSession tests should cover:**
- Constructor validates agent is provided
- Constructor validates tools object is provided
- Constructor rejects reserved tool names
- Constructor stores supervisor from options
- Constructor initializes with idle status
- newPrompt transitions to running status
- newPrompt executes tools via planner decisions
- newPrompt respects maxStepsPerTurn limit
- newPrompt respects maxErrors limit
- Supervisor approve allows tool execution
- Supervisor alwaysApprove caches approval
- Supervisor alwaysApprove skips supervisor on subsequent calls
- Supervisor deny returns error to planner
- Supervisor deny does not execute tool
- Tool variable references resolve correctly
- Loop detection terminates on repeated tool calls
- Awaiting input status pauses session
- Pending input routes to correct tool
- History compresses when threshold is exceeded
- History compression preserves recent entries
- History compression skips while awaiting_input is pending
- History compression failure does not break prompt execution
- History compression prunes toolVars and toolCalls based on keepResultRefs
- History compression skips when markdown response is invalid
- History compression prompt includes resultRef values from toolVars
- Preparation runs before main prompt
- Preparation context injected into prompts
- final_answer tool ends session with done status
- cannot_complete tool ends session with failed status
- Successful skill results returned as final answer
- Failed skill results returned as final answer
- getLastResult returns last answer
- getVariables returns session state
- Cancellation marks session as interrupted and appends interruption history entry
- New prompts recover from interrupted state
