# AchillesAgentLib Architecture

## Overview

AchillesAgentLib is a modular, skill-based agent framework that enables LLM-powered task execution through specialized subsystems. The architecture follows a hierarchical pattern where a central `RecursiveSkilledAgent` discovers, registers, and orchestrates execution of various skill types.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        RecursiveSkilledAgent                            │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                      Skill Discovery                             │   │
│  │  - Scans .AchillesSkills directories                            │   │
│  │  - Registers skills by type (skill.md, cgskill.md, etc.)         │   │
│  │  - Creates aliases for flexible skill resolution                │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                │                                        │
│  ┌─────────────────────────────▼─────────────────────────────────────┐ │
│  │                       Subsystem Router                            │ │
│  │  Routes skill execution to appropriate subsystem based on type    │ │
│  └─────────────────────────────┬─────────────────────────────────────┘ │
│                                │                                        │
│  ┌─────────────────────────────▼─────────────────────────────────────┐ │
│  │                        Subsystems                                  │ │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐  │ │
│  │  │   claude    │ │    code     │ │ interactive │ │     mcp     │  │ │
│  │  │ (skill.md)  │ │ (cgskill.md) │ │ (iskill.md) │ │ (mskill.md) │  │ │
│  │  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘  │ │
│  │  ┌─────────────┐ ┌─────────────┐                                  │ │
│  │  │orchestrator │ │   dbtable   │                                  │ │
│  │  │ (oskill.md) │ │ (tskill.md) │                                  │ │
│  │  └─────────────┘ └─────────────┘                                  │ │
│  └───────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘
```

## Core Components

### 1. RecursiveSkilledAgent (`RecursiveSkilledAgents/RecursiveSkilledAgent.mjs`)

The main entry point and coordinator for skill-based execution.

**Key Responsibilities:**
- **Skill Discovery**: Recursively scans directories for `.AchillesSkills` folders
- **Skill Registration**: Parses skill markdown files and registers them by type
- **Subsystem Management**: Lazily instantiates subsystems on demand
- **Execution Routing**: Routes prompts to appropriate skills/orchestrators
- **Alias Resolution**: Maintains skill aliases for flexible invocation

**Skill File Types:**
| File | Type | Subsystem |
|------|------|-----------|
| `skill.md` | claude | ClaudeSkillsSubsystem |
| `cgskill.md` | code-generation | CodeGenerationSkillsSubsystem |
| `iskill.md` | interactive | InteractiveSkillsSubsystem |
| `mskill.md` | mcp | MCPSkillsSubsystem |
| `oskill.md` | orchestrator | OrchestratorSkillsSubsystem |
| `tskill.md` | dbtable | DBTableSkillsSubsystem |

**Key Methods:**
```javascript
// Execute with automatic skill selection
await agent.executePrompt(taskDescription, options);

// Execute with explicit skill
await agent.executeWithReviewMode(taskDescription, { skillName: 'my-skill' }, 'none');

// Execute with LLM review
await agent.executePromptWithReview(taskDescription, options);

// Execute with human review
await agent.executePromptWithHumanReview(taskDescription, options);
```

---

### 2. LLMAgent (`LLMAgents/LLMAgent.mjs`)

The core LLM interface that all subsystems use for AI-powered operations.

**Key Features:**
- Configurable invoker strategy for different LLM providers
- Memory integration (global, user, session, skill-scoped)
- Multiple response shapes: text, json, code
- Task execution with review modes
- Intent classification and message interpretation

**Key Methods:**
```javascript
// Simple completion
const result = await llmAgent.complete({ prompt, history, mode: 'fast' });

// Execute prompt with memory context
const result = await llmAgent.executePrompt(promptText, {
    mode: 'fast',           // 'fast' or 'deep'
    responseShape: 'json',  // 'text', 'json', 'code', 'json-code'
    sessionMemory,
});

// Task execution
const result = await llmAgent.doTask(agentContext, description, options);

// Message interpretation for conversational flows
const interpretation = await llmAgent.interpretMessage(message, { intents: ['accept', 'cancel', 'update'] });
```

---

### 3. LightSOPLang Interpreter (`lightSOPLang/interpreter.mjs`)

A domain-specific language for defining execution plans with dependency-based parallelization.

**Syntax:**
```
@variableName commandName arg1 arg2 $dependencyVar
```

**Features:**
- **Dependency Resolution**: Variables prefixed with `$` create dependencies
- **Topological Execution**: Commands run in parallel when dependencies allow
- **Auto-Recovery**: Can regenerate plans via LLM when commands fail
- **English Mode**: Accepts `#!english` scripts that LLM translates to commands

**Example Script:**
```
@prompt prompt
@files listFiles $prompt
@analysis analyzeCode $files
@lastAnswer finalAnswer $analysis
```

**Status Types:**
- `STATUS_SUCCESS`: Command completed successfully
- `STATUS_FAIL`: Command failed with error
- `STATUS_UNDEFINED`: Command not yet executed
- `STATUS_CANCELED`: Command was canceled

---

## Subsystems

### 4. OrchestratorSkillsSubsystem (`OrchestratorSkillsSubsystem/OrchestratorSkillsSubsystem.mjs`)

Coordinates multiple skills to accomplish complex tasks.

**Skill Definition (oskill.md):**
```markdown
# MyOrchestrator

Orchestrates multiple skills for complex workflows.

## Instructions
Guidelines for the LLM when creating execution plans.

## Allowed-Skills
- skill-one
- skill-two
- skill-three

## Intents
- create: Creating new items
- update: Updating existing items
- query: Querying data

## Light-SOP-Lang
@prompt prompt
@step1 skill-one $prompt
@step2 skill-two $step1
@lastAnswer finalAnswer $step2

## Fallback
Fallback instructions when main plan fails.

Intent: fallback-mcp
Allowed tools:
- read-file
- write-file
```

**Execution Flow:**
1. Parse skill definition sections
2. Resolve allowed downstream skills
3. Either execute LightSOPLang script OR generate LLM plan
4. Execute plan steps sequentially
5. Trigger fallback if all steps fail/skip

**Key Methods:**
```javascript
// Creates execution plan using LLM
const plan = await subsystem.createPlan({ skillRecord, recursiveAgent, promptText });

// Execute the plan steps
const executions = await subsystem.executePlanSteps({ plan, recursiveAgent, options });
```

---

### 5. CodeSkillsSubsystem (`CodeSkillsSubsystem/CodeSkillsSubsystem.mjs`)

Executes JavaScript code dynamically, either LLM-generated or from modules.

**Skill Definition (cgskill.md):**
```markdown
# MathEvaluator

Evaluates mathematical expressions.

## Prompt
Decide whether to respond directly or craft JavaScript to solve the task.

## Argument
Primary natural-language instruction or text payload.

## LLM-Mode
fast
```

**Execution Modes:**
1. **Default Executor**: LLM decides between text response or code execution
2. **Module Executor**: Loads and executes a `.js` file from skill directory

**Response Decision:**
```json
{
    "mode": "text" | "code",
    "text": "Direct answer if mode is text",
    "code": "JavaScript if mode is code; must end with return <string>;",
    "explanation": "optional"
}
```

**Security Note:** Code is executed via `eval()` within an async IIFE wrapper.

---

### 6. DBTableSkillsSubsystem (`DBTableSkillsSubsystem/DBTableSkillsSubsystem.mjs`)

Manages database table operations with LLM-powered query interpretation.

**Skill Definition (tskill.md):**
```markdown
# Customer Skill

## Table Purpose
Stores customer information for the CRM system.

## Fields

### customer_id
#### Description
Unique identifier for each customer (integer).
#### Primary Key
auto-increment

### email
#### Description
Customer email address.
#### Validator
Must be a valid email format.
#### Required
Always required.

### full_name
#### Aliases
name, customer_name
#### Presenter
Format as "FirstName LastName"
#### Resolver
Parse full name into first and last components

### created_at
#### Description
Timestamp of customer creation.
#### Derivator
Computed as current timestamp on creation.

## Business Rules
- Email must be unique across all customers
- Customer names must not be empty

## Relationships
- Type: one-to-many with orders.customer_id
```

**Operation Flow:**
1. LLM analyzes prompt to determine operation (CREATE, UPDATE, SELECT, DELETE)
2. Generate functions for presenters, resolvers, validators, enumerators, derivators
3. Execute appropriate flow with generated functions
4. Interact with dbAdapter for actual database operations

**Generated Functions:**
- `presenter_<field>`: Converts DB value to human-readable format
- `resolver_<field>`: Converts human input to DB format
- `validator_<field>`: Validates field values
- `enumerator_<field>`: Returns valid options for a field
- `derivator_<field>`: Computes derived/virtual fields
- `prepareRecord`: Prepares record for DB insertion
- `validateRecord`: Validates entire record
- `presentRecord`: Formats record for display

---

### 7. InteractiveSkillsSubsystem (`InteractiveSkillsSubsystem/InteractiveSkillsSubsystem.mjs`)

Handles multi-turn conversational skills with argument collection.

**Skill Definition (iskill.md + module):**
```markdown
# BookingSkill

Interactive skill for making reservations.

## Summary
Guides users through booking process.
```

**Module Structure (`BookingSkill.mjs`):**
```javascript
export const specs = {
    name: 'booking-skill',
    description: 'Make a reservation',
    arguments: {
        date: {
            description: 'Reservation date',
            type: 'date',
            validator: (value) => { /* ... */ },
            enumerator: async () => { /* available dates */ },
        },
        time: {
            description: 'Reservation time',
            llmHint: 'Business hours only',
        }
    }
};

export async function action(args, context) {
    const { date, time } = args;
    // Execute booking logic
    return `Booked for ${date} at ${time}`;
}
```

**Features:**
- Parameter collection via conversation
- LLM-assisted argument resolution
- Confirmation flows
- Session memory integration

---

### 8. MCPSkillsSubsystem (`MCPSkillsSubsystem/MCPSkillsSubsystem.mjs`)

Orchestrates Model Context Protocol (MCP) tools.

**Skill Definition (mskill.md):**
```markdown
# FileManager

Manages file operations using MCP tools.

## Instructions
Use appropriate file tools based on the operation type.

## Allowed-Tools
- list-files
- read-file
- write-file
- delete-file

## Light-SOP-Lang
@prompt prompt
@files list-files $prompt
@lastAnswer finalAnswer $files
```

**Execution:**
1. Filter available tools by allowlist
2. Either execute LightSOPLang script OR generate LLM plan
3. Schedule tool invocations based on plan

---

### 9. ClaudeSkillsSubsystem (`ClaudeSkillsSubsystem/ClaudeSkillsSubsystem.mjs`)

Simple passthrough subsystem for basic Claude skills.

**Skill Definition (skill.md):**
```markdown
# HelperSkill

A simple helper that returns skill information.

## Summary
Basic information about this skill.

Body content with detailed description...
```

**Usage:** Returns skill metadata without LLM execution. Useful for documentation or simple info retrieval.

---

## Utility Components

### Sanitiser (`utils/Sanitiser.mjs`)

Normalizes skill names and identifiers.

```javascript
Sanitiser.sanitiseName('My Skill Name');  // 'my-skill-name'
Sanitiser.sanitiseName('skill_v2.0');     // 'skill-v2-0'
```

### MemoryContainer (`MemoryContainer/MemoryContainer.mjs`)

Manages conversation history for skills.

```javascript
const memory = new MemoryContainer({ initialHistory: [] });
memory.appendToHistory({ user: 'Hello', ai: 'Hi there!' });
const context = memory.getFullContext();
```

### FlexSearch Adapter (`SkilledAgents/search/flexsearchAdapter.mjs`)

Powers skill search and selection.

```javascript
const index = createFlexSearchAdapter({ tokenize: 'forward' });
index.add('skill-id', 'searchable text content');
const matches = index.search('query', { limit: 5 });
```

---

## Execution Flow

### 1. Without Explicit Skill
```
executePrompt(taskDescription)
    └─► selectOrchestratorForPrompt(taskDescription)
        ├─► [orchestrator found] → OrchestratorSubsystem.executeSkillPrompt()
        └─► [no orchestrator] → chooseSkillWithLLM() → executeWithReviewMode()
```

### 2. With Explicit Skill
```
executeWithReviewMode(taskDescription, { skillName })
    └─► getSkillRecord(skillName)
        └─► ensureSubsystem(skillRecord.type)
            └─► subsystem.executeSkillPrompt({ skillRecord, promptText, options })
```

### 3. Orchestrator Execution
```
OrchestratorSubsystem.executeSkillPrompt()
    ├─► [has module] → executeModuleSkill()
    ├─► [has script] → executeScriptPlan() via LightSOPLang
    └─► [LLM plan] → createPlan() → executePlanSteps()
        └─► [all failed] → executeFallbackReact()
```

---

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `ACHILLES_ORCHESTRATOR_TIMEOUT` | Timeout for orchestrator skills (ms) | 90000 |
| `ACHILLES_SKILL_TIMEOUT` | Timeout for code skills (ms) | 60000 |
| `ACHILLES_DBTABLE_TIMEOUT` | Timeout for DB table skills (ms) | 60000 |

---

## Directory Structure

```
.AchillesSkills/
├── my-orchestrator/
│   └── oskill.md           # Orchestrator skill definition
├── my-code-skill/
│   ├── cgskill.md           # Code generation skill definition
│   └── my-code-skill.js    # Optional module implementation
├── my-interactive-skill/
│   ├── iskill.md           # Interactive skill definition
│   └── my-interactive-skill.mjs  # Required module with specs + action
├── my-db-skill/
│   ├── tskill.md           # DB table skill definition
│   └── tskill.generated.mjs # Auto-generated functions
├── my-mcp-skill/
│   └── mskill.md           # MCP tool skill definition
└── my-claude-skill/
    └── skill.md            # Basic Claude skill definition
```

---

## Best Practices

1. **Skill Naming**: Use descriptive, hyphenated names that reflect the skill's purpose
2. **Orchestrator Design**: Keep orchestrators focused; compose multiple for complex workflows
3. **Code Skills**: Prefer module-based implementation for complex logic
4. **DB Skills**: Define clear validators and presenters for data integrity
5. **Interactive Skills**: Design clear argument flows with helpful llmHints
6. **Testing**: Mock the LLMAgent and dbAdapter for unit tests

---

## Error Handling

All subsystems follow consistent error patterns:

```javascript
try {
    const result = await subsystem.executeSkillPrompt({ ... });
} catch (error) {
    // Errors include:
    // - Skill not found
    // - LLM execution failure
    // - Timeout exceeded
    // - Validation failure
    // - Module load failure
}
```

Orchestrators support fallback execution when primary plans fail, providing graceful degradation.
