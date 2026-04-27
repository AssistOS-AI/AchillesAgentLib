# DS002 - Execution and Sessions

## executePrompt

Primary method for user-to-LLM communication. Manages session lifecycle automatically.

**Parameters:**
- message — the user's text input
- options — optional object containing sessionId, model, tags, and systemPrompt

**Session resolution:**
- If sessionId is provided, uses that session
- If sessionId is omitted, uses the default session
- If the session does not exist, creates a new one
- If the session exists, reuses it and appends the new message

**Flow:**
```
executePrompt(message, options)
    │
    ▼
Resolve sessionId (provided or default)
    │
    ▼
Check if session exists in _sessions
    │
    ├─► [no session]
    │   1. Build tools from ALL registered skills
    │   2. Create new LoopAgentSession via LLMAgent
    │   3. Pass model, tags, systemPrompt, supervisor through
    │   4. Store session in _sessions
    │
    └─► [session exists]
        1. Call session.newPrompt(message)
        2. History from previous turns is preserved
    │
    ▼
Return session result
```

**Tool building for sessions:**
- ALL registered skills are exposed as tools (internal and user skills)
- Each tool has a handler that calls executeSkill internally
- Tool names are sanitised short names
- Tool descriptions come from the skill descriptor

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

Sessions are stored in a Map keyed by sessionId. Each session is a LoopAgentSession instance.

**Creation:**
- First executePrompt call with a given sessionId creates the session
- Session is stored and persists in memory

**Reuse:**
- Subsequent executePrompt calls with the same sessionId reuse the existing session
- Conversation history is preserved across turns
- The session is never recreated while it exists

**Deletion:**
- deleteSession removes a session from the map
- The session cannot be recovered after deletion
- Next executePrompt with that sessionId will create a new session

**Default session:**
- When no sessionId is provided, a default key is used
- The default session is excluded from active sessions listing

## Session Management Methods

| Method | Behavior |
|--------|----------|
| deleteSession(sessionId) | Removes session, returns true if existed |
| hasSession(sessionId) | Returns true if session exists |
| getActiveSessions() | Returns array of non-default session IDs |
| clearSessions() | Removes all sessions |
| shutdown() | Clears all sessions |

## Model and Tags Passthrough

MainAgent does NOT resolve which model to use. The model and tags parameters pass through the entire chain unchanged:

```
MainAgent → LLMAgent → invokerStrategy → LLMClient.resolveModelForInvocation()
```

Actual model resolution happens only in LLMClient. MainAgent treats model and tags as opaque pass-through values.

## What Execution Does NOT Do

- Does NOT support review modes (none, llm, human)
- Does NOT generate conversation summaries
- Does NOT select orchestrators automatically for executePrompt
- Does NOT perform heuristic skill selection
- Does NOT inject session memory into options
- Does NOT inject I/O services into options
- Does NOT support SOP sessions (only loop sessions for executePrompt)

## Testable Functionality

Test files should be created in tests/mainAgent/

**executePrompt tests should cover:**
- Creates new session when none exists
- Reuses existing session on subsequent calls
- Passes model parameter through unchanged
- Passes tags parameter through unchanged
- Passes systemPrompt through to session
- Uses default session when no sessionId provided
- Returns session result

**executeSkill tests should cover:**
- Finds skill by canonical name
- Finds skill by short name (alias)
- Throws error when skill not found
- Delegates to correct subsystem
- Passes options through to subsystem

**Session management tests should cover:**
- First executePrompt creates session
- Second executePrompt with same sessionId reuses session
- Different sessionId creates separate session
- Session history is preserved across turns
- deleteSession removes session
- clearSessions removes all sessions
- getActiveSessions excludes default session
- shutdown clears all sessions
