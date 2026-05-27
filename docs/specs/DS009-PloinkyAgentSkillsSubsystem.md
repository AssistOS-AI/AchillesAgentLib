# DS009 — PloinkyAgentSkillsSubsystem

## Overview

The `PloinkyAgentSkillsSubsystem` is a dynamic coordination subsystem that enables orchestrator skills to discover and call remote Ploinky agents through the router. Unlike other subsystems, it does not participate in skill discovery and has no descriptor file type. Instead, it is instantiated lazily by `OrchestratorSkillsSubsystem` when an orchestrator declares remote agents in its `## Allowed Agents` section.

## Architecture

```
PloinkyAgentSkillsSubsystem
├── fetchAgentCards()        → query router /agent-card via AgentHttpClient
├── buildAgentAsTools()      → wrap agent names as callable tools with chatCompletions
├── _buildAgentDescription() → derive tool description from agent-card metadata
└── _extractTextFromCompletion() → extract response text from OpenAI-style payload
```

## Discovery Participation

The subsystem does **not** participate in filesystem skill discovery. There is no `pskill.md` descriptor type. The `SKILL_FILE_TYPES` mapping in `discoverSkills.mjs` does not include a ploinky entry.

The subsystem is registered in `SubsystemFactory` under type `'ploinky'` so that `MainAgent.ensureSubsystem('ploinky')` can instantiate it on demand.

## Allowed Agents Integration

When an orchestrator skill (`oskill.md`) includes a `## Allowed Agents` section, the `OrchestratorSkillsSubsystem` uses `PloinkyAgentSkillsSubsystem` to convert those agent names into callable tools within the agentic session.

### Descriptor Section

```markdown
## Allowed Agents

- openaiAgent
- claudeAgent
- researchAgent
```

Aliases accepted: `allowed-agents`, `agents`, `agent-allowlist`.

### Execution Flow

1. `OrchestratorSkillsSubsystem.prepareSkill()` parses the `## Allowed Agents` section into `preparedConfig.allowedAgents`
2. During `executeLoopAgentSession()` or `executeSOPAgentSession()`:
   - After building local skills as tools, the orchestrator calls `_buildAgentTools()`
   - `_buildAgentTools()` calls `mainAgent.ensureSubsystem('ploinky')`
   - The ploinky subsystem calls `fetchAgentCards()` to get all available agent metadata
   - For each agent in `allowedAgents`, `buildAgentAsTools()` creates a tool wrapper:
     - **Tool name**: the agent name (sanitized)
     - **Description**: derived from the agent-card (summary, tags, usage guidance, etc.)
     - **Handler**: calls `agentHttpClient.chatCompletions(agentName, { messages: [{role:'user', content: promptText}] })` and extracts the response text
   - Agent tools are merged into the session's toolbelt alongside local skill tools

## Router Awareness

### fetchAgentCards()

Queries the Ploinky router's `/agent-card` endpoint:

```javascript
// Fetch all agent cards
const allCards = await subsystem.fetchAgentCards({
  routerUrl: 'http://127.0.0.1:8080',
  env: process.env,
});

// Fetch a specific agent's card
const agentCard = await subsystem.fetchAgentCards({
  agentName: 'openaiAgent',
  routerUrl: 'http://127.0.0.1:8080',
});
```

## Agent Tool Execution

Each agent tool receives a plain text prompt from the orchestrator session. The handler:

1. Constructs an OpenAI-compatible payload: `{ messages: [{ role: 'user', content: promptText }] }`
2. Sends it via `AgentHttpClient.chatCompletions(agentName, payload)`
3. Extracts the response text from `choices[0].message.content`
4. Returns the text to the session

This means agents are called through the same OpenAI-compatible interface that all Ploinky agents expose, regardless of their underlying LLM provider.

## Configuration

```javascript
const subsystem = new PloinkyAgentSkillsSubsystem({
  mainAgent,          // Optional: MainAgent instance
  modelConfig,        // Optional: { plan: 'plan', code: 'code' }
});
```

## Tool Description Generation

The `_buildAgentDescription()` method derives a tool description from the agent-card metadata. It concatenates available fields in this order:

1. `summary`
2. `description`
3. `tags` (formatted as "Tags: tag1, tag2")
4. `whenToUse` (formatted as "Use when: ...")
5. `whenNotToUse` (formatted as "Avoid when: ...")
6. `inputConventions` (formatted as "Input: ...")
7. `outputConventions` (formatted as "Output: ...")
8. `usageGuidance`

If no metadata is available, the description falls back to `"Agent: <name>"`.

## Error Handling

| Scenario | Behavior |
|----------|----------|
| No ploinky subsystem available | Returns empty tools/descriptions, logs debug message |
| `fetchAgentCards` network failure | Propagated from `AgentHttpClient` |
| Agent not found in cards | Tool created with fallback description, handler will fail at call time |
| Unexpected response shape | `_extractTextFromCompletion` stringifies the response |

## AgentHttpClient

`AgentHttpClient` is the HTTP client used by `PloinkyAgentSkillsSubsystem` to call the Ploinky router's agent endpoints. It lives at `PloinkyAgentSkillsSubsystem/AgentHttpClient.mjs` within the `achillesAgentLib` package, so it is available inside agent containers without depending on external paths.

### Exports

- `createAgentHttpClient(options)` — creates a client instance with `routerUrl`, `env`, `requestHeaders`, and `timeoutMs` options
- `getRouterUrl(env)` — resolves the router URL from `PLOINKY_ROUTER_URL` or `PLOINKY_ROUTER_HOST`/`PLOINKY_ROUTER_PORT`
- `getAgentCardUrl(agentName, options)` — returns the URL for `/agent-card/<agent>`
- `getAgentCardsUrl(options)` — returns the URL for `/agent-card` (aggregate)
- `getAgentChatCompletionsUrl(agentName, options)` — returns the URL for `/v1/chat/completions/<agent>`

### Client Methods

- `client.agentCard(agentName?)` — fetches aggregate or single agent card
- `client.chatCompletions(agentName, payload)` — sends a non-streaming chat completion request
- `client.chatCompletionsStream(agentName, payload)` — returns an async iterator over SSE events

### Router Endpoint Policy

The `/agent-card` and `/v1/chat/completions/<agent>` routes are public at the Ploinky router level. The router acts as a transparent proxy; the target agent decides whether to accept or reject the request. No browser cookies or API keys are required at the router layer for these endpoints.
