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

---

## Agent Skills Conventions

This section captures the conventions applied while building the interactive skill format for Achilles agents.

### Repository Layout

- Each test or integration scenario owns its own skill repository.
- Skill repositories live underneath a `.AchillesSkills/` directory placed at the root of the scenario (e.g. `tests/iskills/<scenario>/.AchillesSkills/<repo>/<skill>/`).
- A skill folder name acts as the skill's short name. When a JavaScript entrypoint is present it should use the same short name, for example `deploy_update/deploy_update.js`.
- Additional resources (fixtures, data files, etc.) required by the skill live alongside the skill folder.

### Skill Descriptors

Each skill folder may include one or more descriptor files depending on the type of the skill. The interactive skills use `iskill.md` for their canonical description.

**Descriptor expectations:**

- The markdown file should capture the business context, required inputs, optional inputs, and any execution notes.
- The first heading inside the file becomes the human-readable title displayed in tooling.
- New skill types expand the descriptor catalogue:
  - `mskill.md` — metadata for MCP orchestration skills. Sections such as **Instructions** describe the system prompt, while **Allowed Tools** can list a constrained set of MCP tools that the subsystem may invoke.
  - `oskill.md` — metadata for orchestration skills. The **Instructions** section guides planning, **Allowed Skills** can limit which skills the orchestrator may call, and **Intents** declares the intent taxonomy that should be considered during planning.
  - Orchestration descriptors may optionally provide a **Fallback** section. When present, the agent is authorised to invent an ad-hoc MCP plan using the supplied ReAct-style instructions and the optional fallback tool allow-list whenever no predefined skill fits the request.

### Entrypoints

- Interactive skills can provide an optional JavaScript entrypoint named after the skill's short name (`<skill_short_name>.js`).
- The module should export:
  - `specs`: the structured skill definition consumed by the skill registry.
  - `roles`: an array describing allowed roles.
  - `action`: the function that executes the skill. Tests may use simple stubs that echo the collected arguments.
- Entrypoints can also expose optional helpers (e.g. `configure`) when a scenario needs additional setup.

### Execution API Expectations

- Tests and integrations exercise skills via `RecursiveSkilledAgent.executePrompt(promptText, options)`.
- Each subsystem exposes a `prepareSkill(skillRecord)` hook (invoked during discovery) and a single `executeSkillPrompt({ skillRecord, recursiveAgent, promptText, options })` entry point. `recursiveAgent` supplies shared services such as the configured `LLMAgent` and request `promptReader`.
- The helper harness (`tests/iskills/helpers/runInteractiveSkillScenario.mjs`) initialises a real `LLMAgent`. When credentials are missing the tests are skipped rather than mocked.
- `RecursiveSkilledAgent` understands orchestration and MCP skills:
  - When `executePrompt` is called without an explicit `skillName`, the agent first searches for an orchestrator skill using a FlexSearch heuristic. If a match is found the corresponding `OrchestratorSkillsSubsystem` instance plans and executes downstream skills.
  - If no orchestrator applies, the agent falls back to an LLM-driven (or heuristic) chooser that selects the most appropriate skill from the global catalogue.
  - Orchestration skills can recursively invoke `executePrompt`, but they must always specify the concrete `skillName` when delegating. Indirect recursive calls without a target skill are rejected.
  - MCP skills transform their descriptor instructions into MCP tool plans. An optional allowed-tool list constrains execution even when the runtime advertises additional tools.

### Future Work

- The `MemoryContainer` (formerly `ContextManager`) expects new APIs to accept a `session-memory` entry within their options.
- Additional skill subsystems (Claude, MCP, Code Calling, Orchestrator) now share the same `executeSkillPrompt` shape; reusable helpers can graduate into a `skills/helpers/` folder when patterns emerge.

---

## SkillManagerCli (`cli/skill-manager-cli/skill-manager/`)

A specialized CLI agent for managing, generating, and testing skill definition files in `.AchillesSkills` directories.

### Architecture

```
┌────────────────────────────────────────────────────────────────────────────┐
│                          SkillManagerCli                                    │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                    RecursiveSkilledAgent                              │  │
│  │  - Discovers skills from workingDir + built-in skills                │  │
│  │  - Routes prompts via 'skill-manager' orchestrator                   │  │
│  └───────────────────────────────┬──────────────────────────────────────┘  │
│                                  │                                          │
│  ┌───────────────────────────────▼──────────────────────────────────────┐  │
│  │                    Built-in Skills (.AchillesSkills/)                 │  │
│  │  ┌────────────────┐ ┌────────────────┐ ┌────────────────┐            │  │
│  │  │ skill-manager  │ │  list-skills   │ │  read-skill    │            │  │
│  │  │   (oskill)     │ │   (cgskill)     │ │   (cgskill)     │            │  │
│  │  └────────────────┘ └────────────────┘ └────────────────┘            │  │
│  │  ┌────────────────┐ ┌────────────────┐ ┌────────────────┐            │  │
│  │  │  write-skill   │ │ update-section │ │ delete-skill   │            │  │
│  │  │   (cgskill)     │ │   (cgskill)     │ │   (cgskill)     │            │  │
│  │  └────────────────┘ └────────────────┘ └────────────────┘            │  │
│  │  ┌────────────────┐ ┌────────────────┐ ┌────────────────┐            │  │
│  │  │validate-skill  │ │  get-template  │ │preview-changes │            │  │
│  │  │   (cgskill)     │ │   (cgskill)     │ │   (cgskill)     │            │  │
│  │  └────────────────┘ └────────────────┘ └────────────────┘            │  │
│  │  ┌────────────────┐ ┌────────────────┐ ┌────────────────┐            │  │
│  │  │ generate-code  │ │   test-code    │ │ skill-refiner  │            │  │
│  │  │   (cgskill)     │ │   (cgskill)     │ │   (oskill)     │            │  │
│  │  └────────────────┘ └────────────────┘ └────────────────┘            │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────────┘
```

### File Structure

```
cli/skill-manager-cli/skill-manager/
├── index.mjs                    # CLI entry point & exports
├── SkillManagerCli.mjs          # Main agent class
├── REPLSession.mjs              # Interactive REPL session handler
├── SlashCommandHandler.mjs      # Slash command definitions & execution
├── CommandSelector.mjs          # Interactive command/skill picker
├── HistoryManager.mjs           # Command history persistence
├── ResultFormatter.mjs          # Output formatting utilities
├── HelpPrinter.mjs              # Help display utilities
├── skillSchemas.mjs             # Schema definitions & templates
├── spinner.mjs                  # CLI spinner animation
└── .AchillesSkills/             # Built-in skills
    ├── skill-manager/           # Main orchestrator (oskill)
    ├── list-skills/             # List discovered skills
    ├── read-skill/              # Read skill .md content
    ├── write-skill/             # Create/write skill files
    ├── update-section/          # Update specific sections
    ├── delete-skill/            # Delete skill directories
    ├── validate-skill/          # Validate against schema
    ├── get-template/            # Get blank templates
    ├── preview-changes/         # Show diff before writing
    ├── generate-code/           # Generate .mjs from tskill
    │   └── codeGeneration.prompts.mjs  # Code generation prompts
    ├── test-code/               # Test generated code
    └── skill-refiner/           # Iterative improvement (oskill)
        └── skillRefiner.prompts.mjs    # Skill refinement prompts

tests/skill-manager/             # Test files (separate location)
├── SkillManagerCli.test.mjs
├── SkillManagerCli.integration.test.mjs
├── skillModules.test.mjs
├── allSkills.test.mjs
├── codeGeneration.test.mjs
├── cliFeatures.test.mjs         # REPL, history, slash commands, selectors
└── run-all.mjs
```

### Key Components

#### SkillManagerCli.mjs

Main agent class that wraps `RecursiveSkilledAgent` for skill management.

```javascript
import { SkillManagerCli } from 'achillesAgentLib/cli/skill-manager-cli/skill-manager/SkillManagerCli.mjs';

const agent = new SkillManagerCli({
    workingDir: '/path/to/project',  // Where user skills live
    llmAgent: customLLMAgent,        // Optional custom LLM
});

// Process natural language prompts
const result = await agent.processPrompt('list all skills');

// Execute specific skill directly
await agent.executeSkill('read-skill', 'my-skill');

// Start interactive REPL
await agent.startREPL();

// Get only user skills (excludes built-in)
const userSkills = agent.getUserSkills();

// Reload skills after changes
agent.reloadSkills();
```

#### skillSchemas.mjs

Defines skill type schemas, templates, and validation logic.

```javascript
import {
    SKILL_TYPES,           // Schema definitions for each type
    SKILL_TEMPLATES,       // Blank templates for each type
    detectSkillType,       // Auto-detect type from content
    validateSkillContent,  // Validate against schema
    parseSkillSections,    // Parse markdown sections
    updateSkillSection,    // Update specific section
} from './skillSchemas.mjs';

// Detect skill type
const type = detectSkillType(content);  // 'tskill', 'cgskill', etc.

// Validate content
const result = validateSkillContent(content);
// { valid: true/false, errors: [], warnings: [], detectedType: '...' }

// Update a section
const updated = updateSkillSection(content, 'Summary', 'New summary text');
```

#### Prompt Files (Co-located with Skills)

LLM prompts are kept in `.prompts.mjs` files alongside the skills that use them:

```javascript
// .AchillesSkills/generate-code/codeGeneration.prompts.mjs
export function buildCodeGenPrompt(skillName, content, sections) {
    return `Generate JavaScript/ESM code for...`;
}

// .AchillesSkills/skill-refiner/skillRefiner.prompts.mjs
export function buildEvaluationPrompt(testResult, requirements) { ... }
export function buildFixesPrompt(skillContent, failures, history) { ... }
```

### Built-in Skills

#### skill-manager (oskill)

The main orchestrator that routes user requests to appropriate operations.

**Allowed Skills:**
- `list-skills` - List discovered skills
- `read-skill` - Read skill definition content
- `write-skill` - Create/write skill files
- `update-section` - Update specific sections
- `delete-skill` - Remove skill directories
- `validate-skill` - Validate against schema
- `get-template` - Get blank templates
- `preview-changes` - Show diff before writing
- `generate-code` - Generate .mjs from tskill
- `test-code` - Test generated code
- `skill-refiner` - Iterative improvement

**Usage Pattern:**
```
User: "update joker to tell programming jokes"
↓
skill-manager orchestrator
↓
Plan: [
  { skill: "read-skill", input: "joker" },
  { skill: "update-section", input: {skillName: "joker", section: "Prompt", content: "..."} }
]
```

#### generate-code (cgskill)

Generates `.mjs` code from `tskill.md` definitions using LLM.

- Input: skill name
- Output: `tskill.generated.mjs` file with validators, presenters, etc.
- Uses: `codeGeneration.prompts.mjs` (co-located)

#### skill-refiner (oskill)

Iteratively improves skills until requirements are met.

```
read skill → generate code → test → evaluate → fix → repeat
```

- Max iterations configurable
- Uses LLM to evaluate test results and generate fixes
- Uses: `skillRefiner.prompts.mjs` (co-located)

### CLI Usage

```bash
# Start interactive REPL
skill-manager --dir /path/to/project

# Single-shot command
skill-manager "list all skills"

# With LLM mode
skill-manager --deep "create a tskill called inventory"
```

### REPL Commands

| Command | Description |
|---------|-------------|
| `list`, `ls` | List user skills |
| `list all`, `ls -a` | List all skills (including built-in) |
| `reload` | Refresh skills from disk |
| `help` | Show quick reference |
| `history`, `hist` | Show command history |
| `history <n>` | Show last n history entries |
| `history <query>` | Search history for query |
| `history clear` | Clear command history |
| `exit`, `quit`, `q` | Exit REPL |

### Slash Commands

| Command | Description | Waits for Input |
|---------|-------------|-----------------|
| `/ls`, `/list` | List skills | No |
| `/read <skill>` | Read skill definition | No |
| `/write <skill> [type]` | Create/update skill | No |
| `/delete <skill>` | Delete skill | No |
| `/validate <skill>` | Validate against schema | No |
| `/template <type>` | Get blank template | No |
| `/generate <skill>` | Generate code from tskill | No |
| `/test <skill>` | Test generated code | No |
| `/exec <skill>` | Execute any skill | **Yes** |
| `/refine <skill>` | Iteratively improve skill | **Yes** |
| `/update <skill>` | Update skill section | **Yes** |
| `/help`, `/?` | Show slash command help | No |

### Interactive Features

**Command Selector**: Typing `/` alone shows an interactive command picker with arrow key navigation.

**Skill Selector**: Commands that operate on skills (`/exec`, `/refine`, `/read`, etc.) show an interactive skill picker after command selection.

**Input Prompts**: Some commands wait for additional input after skill selection:
- `/exec` - Shows skill info and prompts for input (guidance varies by skill type)
- `/refine` - Prompts: "Describe what to improve or requirements to meet"
- `/update` - Prompts: "Specify section name and new content"

**History Navigation**: Use ↑/↓ arrow keys to navigate through command history.

**Cancellation**: Press `Ctrl+C` during input prompts to cancel and return to main REPL.

### Environment Variables

| Variable | Description |
|----------|-------------|
| `ACHILLES_ORCHESTRATOR_MODE` | LLM mode: `fast` (default) or `deep` |
| `ANTHROPIC_API_KEY` | Required for Claude LLM |
| `OPENAI_API_KEY` | Alternative: OpenAI API key |

### Code Generation Workflow

1. **Create tskill.md** - Define entity schema with fields
2. **Validate** - `validate-skill skillName`
3. **Generate** - `generate-code skillName` → creates `tskill.generated.mjs`
4. **Test** - `test-code skillName` to verify generated code
5. **Refine** - `skill-refiner skillName` for iterative improvement

### Development Notes

- **Do not edit `tskill.generated.mjs` directly** - Modify `tskill.md` and regenerate
- **Prompts co-located with skills** - Each skill that needs LLM prompts has them in the skill folder (e.g., `generate-code/codeGeneration.prompts.mjs`)
- **Built-in skills hidden** - REPL shows only user skills by default
- **Tests** - 136+ tests in `cliFeatures.test.mjs` covering REPL, history, slash commands, and selectors
- After any change in `cli/skill-manager-cli/skill-manager/` run the `tests/skill-manager/` tests
- The files with the extensions `.generated.mjs` should never be updated directly but instead the `.md` files should be updated and the code will be automatically recreated from the markdown file.

### REPL Architecture

The REPL is composed of modular components:

| Component | File | Purpose |
|-----------|------|---------|
| `REPLSession` | `REPLSession.mjs` | Main REPL loop, input handling, ESC cancellation |
| `SlashCommandHandler` | `SlashCommandHandler.mjs` | Slash command definitions, parsing, execution |
| `CommandSelector` | `CommandSelector.mjs` | Interactive picker with arrow keys, filtering |
| `HistoryManager` | `HistoryManager.mjs` | Per-directory command history persistence |
| `ResultFormatter` | `ResultFormatter.mjs` | Output formatting for skill results |
| `HelpPrinter` | `HelpPrinter.mjs` | Help and history display utilities |

**Command Flow**:
```
User types "/" → CommandSelector shows commands → User selects command
    ↓
Command needs skill? → SkillSelector shows user skills → User selects skill
    ↓
Command needs input? (exec/refine/update) → Show guidance → Wait for input
    ↓
Execute command via SlashCommandHandler
```