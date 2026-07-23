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
session.newPrompt(userPrompt, { model?, tags?, reasoningEffort? })
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
- `initialHistory` — ordered non-empty `{ role, message }` records limited to `user` and `assistant`

**What happens on construction:**
1. Validates agent and tools are provided
2. Validates tool names do not conflict with reserved names
3. Adds reserved tools (final_answer, cannot_complete) to tool set
4. Configures execution limits from options
5. Stores supervisor if provided
6. Initializes empty turns and tool-call tracking, and hydrates internal user/final-answer history entries when valid `initialHistory` is supplied
7. Sets status to idle

## Active Model Across Turns

The session's model, tags, and reasoning effort are active turn options rather than immutable constructor-only values. When `newPrompt()` explicitly receives any of these options, it updates `session.options` before history compression, preparation, pending-input interpretation, or planner execution begins. Omitting an option preserves its current value, so conversation history and model selection can evolve independently.

Planner decisions, pending-input LLM classification, preparation sessions, clarification calls, and ordinary history compression use the active session model. `historyCompressionModel` remains an explicit override for compression only. Skill handlers created by MainAgent also receive the active parent-session model so their Loop or SOP sub-sessions do not fall back to a stale hardcoded planning model.

## Tool Execution with Supervisor

Before executing any tool, the session checks with the supervisor if one is configured.

**Approval flow:**
```
_executeTool(toolName, prompt)
    │
    ▼
Check alwaysApprove cache for this exact tool name and params
    │
    ├─► [cached] → execute directly
    │
    └─► [not cached]
        │
        ▼
        supervisor.approve({ toolName, prompt, params })
        │
        ├─► 'approve' → execute tool
        ├─► 'alwaysApprove' → execute tool + cache approval
        └─► 'deny' → skip handler + store denial as tool result
```

The alwaysApprove cache is stored in a Map keyed by a deterministic serialization of `toolName + params`. Once an exact call is marked as always approved, only subsequent calls with the same tool name and params skip the supervisor check. A structured supervisor result may carry an opaque approval proof, which is cached with the decision and forwarded to the tool handler as `supervisorApproval`.

When approved, the selected handler runs normally and its ordinary result is stored without adding user-approval text or metadata.

When denied, the session must not call the selected tool handler. It stores a human-readable result containing the exact tool name, exact parameters, and supervisor reason under a normal result reference, records the result in history, and continues the planner loop. The planner may choose a safe alternative or explain the refusal, but it must not request the same or an equivalent denied command again in the current turn. Supervisor status fields and raw control JSON are not exposed as conversation text.

## Planner Decision Loop

Each step in the loop:

1. **Request decision** — builds planner system instructions with the available tools and execution-only context. It derives prior user and assistant conversation turns from the existing session history and passes the current user prompt separately as the final user-role message. The canonical LLM response is Markdown with `tool` and `prompt` sections plus an optional `reason` section, which the runtime parses into the planner decision object.

   The canonical Markdown decision remains the primary, non-negotiable, and non-overridable format requested from the planner. The session system prompt, tool descriptions, execution context, prior role-aware conversation, and current user prompt are planning context and must not instruct the model to select a different output format. The parser is deliberately more tolerant than the requested format: section names and JSON property names are case-insensitive; `tool-name`, `tool_name`, `toolName`, and `tool name` are equivalent, as are the corresponding `prompt` forms; headings, inline labels, bold labels, and JSON objects are accepted; and one outer Markdown, text, or JSON fence may wrap the decision. Markdown fields may appear in any order. The last occurrence of a duplicated normalized field wins, while section-looking text inside an internal code fence remains prompt content.

   A structured Markdown or JSON response containing a tool but no prompt executes that tool with an empty string. A response containing only `prompt` or an explicit `final_answer` label becomes a `final_answer` decision. A response containing only `reason` also becomes `final_answer`, with the reason copied into the final prompt. Non-empty non-JSON text without a recognized planner field is treated as the final answer. This fallback never infers a non-terminal tool from prose. Empty responses, non-string values, JSON arrays or primitives, malformed explicitly fenced JSON, and JSON objects without any recognized planner property remain invalid.

2. **Execute tool** — resolves tool variables in the prompt and checks supervisor approval. An approval calls the tool handler; a denial skips the handler and enters the denial reason into normal tool-result context.

3. **Evaluate result:**
   - `__finalAnswer` → session ends with done status
   - `__cannotComplete` → session ends with failed status
   - `requiresConfirmation` or `requiresInput` → session pauses with awaiting_input status
   - `success: true` with records/message → returns as final answer
   - `success: false` → returns as failed answer
   - Otherwise → continue to next step

4. **Loop detection** — if the same tool with the same prompt returns the same result three times, the session terminates with the last result.

5. **Error handling** — tool errors increment an error counter. If maxErrors is reached, the session aborts.

Planner-format failures must state only the response shape, such as an empty response, unsupported JSON, or invalid Markdown. Ordinary non-empty text and JSON objects with recognized planner properties are not planner-format failures because they are normalized into decisions. Tool execution errors must identify unavailable tool names and unresolved `$$resultRef` values literally. These messages do not introduce a new error layer; they are emitted from the existing parser and execution sites.

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

- **history** — chronological log of user prompts, tool calls, and session events. Each entry has a `type` (`user`, `tool_call`, `tool`, `awaiting_input`, `final_answer`, `cannot_complete`, `validation_failed`, `timeout`, `history_summary`). For `tool` entries, `resultRef` identifies the result stored in `toolVars`. The runtime keeps this schema unchanged and derives provider-facing `{ role, message }` records only when requesting a planner decision.
- **toolCalls** — flat list of all tool invocations with metadata (`tool`, `prompt`, `resultRef`). Used to quickly identify the most recent tool call for planner context. Does not store the result value itself.
- **toolVars** — Map of `resultRef` to the actual tool result value. Single source of truth for tool outputs. Referenced by history entries and resolved via `$$resultRef` syntax in subsequent prompts.

**turns** — array of turn objects, each containing steps, final answer, and status (used for execution tracking, not context building).

Tool results are stored in `toolVars` with auto-generated references (e.g., `toolName-res-1`) that can be referenced in subsequent prompts using `$$variableName` syntax.

LoopAgentSession exposes `getConversationSnapshot()` for delegated skill execution. The snapshot contains `history`, `status`, and `lastAnswer`, and is cloned so downstream consumers cannot mutate the live session state. Tool result payloads are not included in the snapshot; tool call records remain available through `history`, while the separate internal `toolCalls` index is not included.

Initial role-aware history is a creation-only input rather than a second persisted history schema. The constructor validates it, translates each user record to `{ type: 'user', prompt }` and each assistant record to `{ type: 'final_answer', answer }`, and then uses the ordinary provider-facing history derivation. The current prompt remains a separate final user message.

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
- Supervisor alwaysApprove is scoped to exact tool params
- Structured supervisor decisions propagate denial reasons and approval proofs
- Supervisor deny stores its reason as an ordinary result and continues the planner loop
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
- New prompts can replace the active model without recreating the session or losing history
- Planner calls keep system instructions, earlier user/assistant turns, and the current user prompt in separate role records
- Initial history hydrates earlier user/assistant turns without serializing them into the current prompt
- Invalid initial history roles and empty messages are rejected
- Provider-facing role derivation does not add `role` fields to session history entries
- Pending-input interpretation receives the active model and tags

## Decisions & Questions

### Question #1: Why is the planner Markdown shape declared non-overridable inside the prompt?

Response: The planner consumes system-prompt content, tool descriptions, historical outputs, and user-controlled text in one planning context. Repeating the structural rule before and after that context establishes that those inputs are data for the decision rather than alternative output-format instructions. This keeps non-terminal tool selection explicit even though the runtime can safely recover direct prose as `final_answer`.

### Question #2: Why do planner errors distinguish response shapes?

Response: The former generic parse failure did not show whether the model returned no text, unsupported JSON, or malformed structured output. Reporting only that structural category makes the remaining model-contract failures actionable without exposing or semantically interpreting the response content. Ordinary text and supported planner JSON no longer enter this error path.

### Question #3: Why does the tolerant parser not infer tool names from ordinary prose?

Response: Parser recovery must not turn ambiguous language into an external action. Explicit tool fields may use harmless spelling and layout variants, but a response without such a field can only finish through `final_answer`. This improves provider compatibility without widening the tool-execution authority of the planner response.

## Conclusion

LoopAgentSession must require an explicit structured decision before executing a non-terminal tool. It may normalize common planner formatting variations or convert unstructured text into `final_answer`, but it must never infer an external tool call from that text.
