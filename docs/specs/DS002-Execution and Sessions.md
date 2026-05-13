# DS002 - Execution and Sessions

## executePrompt

Primary method for user-to-LLM communication. Manages a single session lifecycle automatically.

**Parameters:**
- message — the user's text input
- options — optional object containing model, tags, systemPrompt, and signal

**Session resolution:**
- MainAgent keeps one in-memory LoopAgentSession instance
- If the session does not exist, executePrompt creates it
- If the session exists, executePrompt reuses it and appends the new message

**Flow:**
```
executePrompt(message, options)
    │
    ▼
Check if _session exists
    │
    ├─► [no session]
    │   1. Build tools from ALL registered skills
    │   2. Create new LoopAgentSession via LLMAgent
    │   3. Pass model, tags, systemPrompt, supervisor through
    │   4. Store session in _session
    │
    └─► [session exists]
        1. Call _session.newPrompt(message, { signal })
        2. History from previous turns is preserved
    │
    ▼
Return session result
```

**Tool building for sessions:**
- Registered skills are exposed as tools unless they are explicitly listed in an orchestrator skill's Allowed Skills or Allowed Preparation Skills sections
- Each tool has a handler that calls executeSkill internally
- Tool names are sanitised short names
- Tool descriptions come from the skill descriptor
- Orchestrator-owned skills remain executable through executeSkill so the orchestrator can call them, but they are not exposed as top-level tools during executePrompt sessions

## executeSkill

Direct execution of a registered skill by name or alias.

**Parameters:**
- skillName — name or alias of the skill
- prompt — input text for the skill
- options — optional object passed through to the subsystem

**Flow:**
```
executeSkill(skillName, prompt, options)
    │
    ▼
Resolve skill record via alias lookup
    │
    ├─► [not found] → throw Error
    │
    └─► [found]
        1. Get subsystem by skill type
        2. Call subsystem.executeSkillPrompt()
        3. Pass skillRecord, this agent reference, prompt, options
    │
    ▼
Return subsystem result
```

## Session Lifecycle

MainAgent stores one LoopAgentSession in `_session`.

**Creation:**
- First executePrompt call creates `_session`

**Reuse:**
- Subsequent executePrompt calls reuse `_session`
- Conversation history is preserved across turns

**Shutdown:**
- shutdown clears `_session`

**Interruption:**
- When an AbortSignal aborts or `cancelCurrentSession()` is called, the active session enters `interrupted` status
- The session appends an interruption event to history, so later planning turns can observe the interruption context
- A new user prompt exits `interrupted` state and returns the session to normal execution

## Model and Tags Passthrough

MainAgent does NOT resolve which model to use. The model and tags parameters pass through unchanged:

```
MainAgent → LLMAgent → invokerStrategy → LLMClient.resolveModelForInvocation()
```

Actual model resolution happens in LLMClient.

## What Execution Does NOT Do

- Does NOT expose sessionId-based APIs
- Does NOT support concurrent multi-session routing in MainAgent
- Does NOT support review modes (none, llm, human)
- Does NOT generate conversation summaries
- Does NOT select orchestrators automatically for executePrompt
- Does NOT perform heuristic skill selection
- Does NOT inject session memory into options
- Does NOT inject I/O services into options
- Does NOT support SOP sessions (executePrompt uses loop sessions)

## Testable Functionality

Test files should be created in tests/mainAgent/

**executePrompt tests should cover:**
- Creates new session when none exists
- Reuses existing session on subsequent calls
- Passes model parameter through unchanged
- Passes tags parameter through unchanged
- Passes systemPrompt through to session
- Passes signal through to session creation and reused session prompts
- Returns session result

**executeSkill tests should cover:**
- Finds skill by canonical name
- Finds skill by short name (alias)
- Throws error when skill not found
- Delegates to correct subsystem
- Passes options through to subsystem

**Session management tests should cover:**
- First executePrompt creates session
- Second executePrompt reuses existing session
- shutdown clears session
- cancelCurrentSession marks active session interrupted
