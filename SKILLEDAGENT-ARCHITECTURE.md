# SkilledAgent Architecture Documentation

## Overview

The **SkilledAgent** system is a sophisticated framework for building conversational AI agents that execute discrete "skills" (task handlers) through natural language interaction. It provides a complete solution for skill registration, discovery, argument collection, validation, and execution with built-in LLM-powered assistance.

### Key Capabilities

- **Skill Registration & Discovery**: Automatically register and search skills using semantic similarity
- **LLM-Powered Skill Selection**: Intelligently choose the best skill for a user request
- **Interactive Argument Collection**: Gather required parameters through conversational prompts
- **Flexible Argument Resolution**: Support enumerators, validators, resolvers, and presenters
- **Role-Based Access Control**: Filter skills based on user roles
- **Confirmation Flows**: Optional user confirmation before execution
- **Alias Support**: Multiple names for the same argument
- **Rich User Experience**: Natural language input, helpful prompts, option suggestions

---

## Architecture Components

The SkilledAgent system consists of several interconnected components:

```
┌─────────────────────────────────────────────────────────────────┐
│                        SkilledAgent                             │
│  • Main orchestrator class                                      │
│  • Delegates to SkillRegistry and executor subsystem            │
└────────────┬────────────────────────────────────┬───────────────┘
             │                                    │
             ▼                                    ▼
┌────────────────────────┐         ┌──────────────────────────────┐
│   SkillRegistry        │         │   Executor Subsystem         │
│  • Stores skills       │         │  • context.mjs               │
│  • Search index        │         │  • mainLoop.mjs              │
│  • Argument metadata   │         │  • messages.mjs              │
│  • Access control      │         │  • llm.mjs                   │
└────────────────────────┘         └──────────────────────────────┘
             │
             ▼
┌────────────────────────┐
│  FlexSearch Adapter    │
│  • Semantic search     │
│  • Skill ranking       │
└────────────────────────┘
```

### 1. **SkilledAgent** (Main Class)

The central orchestrator that provides the public API for interacting with the skill system.

**Location**: `SkilledAgents/SkilledAgent.mjs`

**Key Responsibilities**:
- Instantiate and manage SkillRegistry and LLMAgent
- Provide skill registration interface
- Execute skill selection using LLM
- Coordinate skill execution
- Handle user prompts and processing callbacks

**Constructor Parameters**:
```javascript
{
    llmAgent,              // Required: LLMAgent instance for AI operations
    skillRegistry,         // Optional: Custom SkillRegistry instance
    promptReader,          // Optional: Custom function for reading user input
    onProcessingStart,     // Optional: Callback when LLM processing begins
    onProcessingEnd        // Optional: Callback when LLM processing ends
}
```

**Public Methods**:
- `registerSkill(config)`: Register a new skill
- `rankSkill(taskDescription, options)`: Get ranked skills for a task
- `chooseSkillWithLLM(rankScores, options)`: Use LLM to select best skill
- `executeSkill(skillName, options)`: Execute a specific skill
- `useSkill(skillName, options)`: Alias for executeSkill
- `getSkill(name)`: Retrieve skill definition
- `listSkillsForRole(role)`: List skills available to a role
- `doTask(agentContext, description, options)`: Execute arbitrary LLM task
- `brainstormQuestion(question, options)`: Generate ideas using LLM
- `cancelTasks()`: Cancel ongoing LLM operations

---

### 2. **SkillRegistry**

Manages skill storage, search indexing, and argument metadata processing.

**Location**: `SkilledAgents/SkillRegistry.mjs`

**Key Responsibilities**:
- Store skill definitions and action functions
- Build and maintain search index for semantic skill discovery
- Validate skill specifications
- Process argument definitions (validators, enumerators, resolvers, presenters)
- Handle argument aliases
- Filter skills by user role

**Data Structures**:
```javascript
// Internal storage
this.skills = new Map()    // canonicalName -> skill record
this.actions = new Map()   // canonicalName -> action function
this.index = FlexSearchAdapter  // Search index
```

**Skill Registration Flow**:
1. Validate skill object has `specs`, `action`, and `roles`
2. Sanitize specs (normalize arguments, check required fields)
3. Process argument definitions:
   - Extract validators (functions that check if values are valid)
   - Extract enumerators (functions that provide option lists)
   - Extract resolvers (functions that transform/lookup values)
   - Extract presenters (functions that format values for display)
4. Build search text from skill metadata
5. Add to index for semantic search
6. Store skill record and action function

**Skill Ranking Algorithm**:
1. Search index using task description
2. Filter results by user role(s)
3. Return top N matches with ordinal scores (1-5)

**Argument Definition Processing**:

The registry normalizes argument definitions from various formats:

```javascript
// Input formats supported:
{
    equipment_id: {
        type: 'string',              // Base type
        description: '...',          // Human description
        llmHint: '...',             // Additional hint for LLM
        default: 'value',            // Default value
        validator: '@checkUnique',   // Validator reference (@ prefix)
        enumerator: '%listItems',    // Enumerator reference (% prefix)
        resolver: '&lookupById',     // Resolver reference (& prefix)
        presenter: 'formatItem',     // Presenter reference
        options: [...],              // Static option list (creates inline enumerator)
    }
}

// Resolves handler functions from skill module:
- Direct functions: skillObj['checkUnique']
- Container objects: skillObj.argumentValidators['checkUnique']
- Multiple naming conventions supported
```

---

### 3. **Executor Subsystem**

Handles the interactive argument collection and validation loop.

#### 3.1 **context.mjs**

Creates an execution context that encapsulates all state for skill execution.

**Location**: `SkilledAgents/executor/context.mjs`

**Key Function**: `createExecutionContext({ skill, action, providedArgs, llmAgent, securityContext })`

**Context Object Structure**:
```javascript
{
    // Core references
    skill,                    // Skill definition
    action,                   // Action function to execute
    llmAgent,                 // LLM agent instance
    securityContext,          // User/role information
    
    // Argument metadata
    argumentDefinitions,      // Processed argument definitions
    requiredArguments,        // List of required argument names
    optionalArguments,        // List of optional argument names
    definitionMap,            // Map: name -> definition
    
    // State management
    normalizedArgs,           // Collected & validated argument values
    invalidArgs,              // Set of argument names that failed validation
    
    // Options & search
    optionEntries,            // Map: argument -> normalized options
    optionSearches,           // Map: argument -> FlexSearch index
    optionTotalCounts,        // Map: argument -> total option count
    
    // Handlers
    validatorMap,             // Map: argument -> validator function
    resolverMap,              // Map: argument -> resolver function
    presenterMap,             // Map: argument -> presenter function
    
    // Aliases
    aliasEntries,             // Map: argument -> array of aliases
    aliasToArgument,          // Map: lowercase alias -> canonical name
    
    // Helper methods
    hasValue(name),           // Check if argument has valid value
    setValue(name, value),    // Set and validate an argument
    applyUpdates(updates),    // Apply multiple updates
    resolveRawValue(name, raw), // Resolve and validate raw value
    getOptionSamples(name),   // Get option examples
    describeArgument(name),   // Get human-friendly description
    presentValue(name, val),  // Format value for display
    missingRequired(),        // Get list of missing required args
    missingOptional(),        // Get list of missing optional args
    validationState(),        // Get complete validation status
    isCancellationIntent(text), // Check if user wants to cancel
    getAliases(name),         // Get aliases for argument
    resolveArgumentKey(key),  // Resolve alias to canonical name
    toJSON(),                 // Export final arguments
}
```

**Placeholder Detection**:

The `hasValue()` method includes sophisticated detection of LLM-generated placeholder values:

```javascript
// Detects and rejects:
- Empty strings
- "not_provided", "not_set", "missing", "unknown", "none"
- "your_job_name", "yourjobname" (generic placeholders)
- Any string starting with "your" that looks like a placeholder
```

**Option Resolution**:

For enumerated arguments, the context:
1. Loads options from enumerator function
2. Normalizes entries (supports rich format: `{ value, label, description, synonyms }`)
3. Builds FlexSearch index for fuzzy matching
4. Attempts exact match, synonym match, then fuzzy search
5. Returns matched value or failure

**Value Coercion**:

Based on argument type:
- `boolean`: "true", "1", "yes" → true; "false", "0", "no" → false
- `integer`: Parse and truncate to integer
- `number`: Parse to float
- Auto-detect JSON objects/arrays in strings

**Resolver Chain**:

For each argument value:
1. Apply custom resolver if present (for lookups/transformations)
2. OR match against enumerated options
3. Coerce by type
4. Run validator
5. Accept or reject

---

#### 3.2 **mainLoop.mjs**

The interactive loop that collects missing arguments and confirms execution.

**Location**: `SkilledAgents/executor/mainLoop.mjs`

**Key Function**: `mainLoop(context, { readUserPrompt, taskDescription })`

**Flow Diagram**:

```
┌─────────────────────────────────────────────────────────────────┐
│ Start: Apply initial arguments from taskDescription            │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
         ┌───────────────────────┐
         │ Check Validation      │
         │ All required present? │
         └───┬───────────────┬───┘
             │               │
          NO │               │ YES
             │               │
             ▼               ▼
   ┌──────────────────┐   ┌──────────────────────┐
   │ Display Missing  │   │ needConfirmation?    │
   │ Argument Prompt  │   └──┬────────────────┬──┘
   └────────┬─────────┘      │                │
            │               YES              NO
            ▼                │                │
   ┌──────────────────┐      │                ▼
   │ Read User Input  │      │          ┌───────────┐
   └────────┬─────────┘      │          │ Execute!  │
            │                │          └───────────┘
            ▼                │
   ┌──────────────────┐      │
   │ Cancel Intent?   │      │
   └──┬───────────┬───┘      │
      │ YES       │ NO       │
      │           │          │
      ▼           ▼          ▼
   ┌─────┐  ┌──────────┐  ┌──────────────────┐
   │Error│  │Parse Args│  │Display Summary   │
   └─────┘  │via LLM   │  │& Ask Confirm     │
            └────┬─────┘  └────────┬─────────┘
                 │                 │
                 ▼                 ▼
            ┌─────────┐      ┌──────────────┐
            │Apply    │      │Read Response │
            │Updates  │      └──────┬───────┘
            └────┬────┘             │
                 │                  ▼
                 │           ┌──────────────────┐
                 │           │Classify Intent:  │
                 │           │ - accept         │
                 │           │ - cancel         │
                 └───────────┤ - update         │
                             └──────┬───────────┘
                                    │
             ┌──────────────────────┼────────────────┐
             │                      │                │
          accept                 cancel           update
             │                      │                │
             ▼                      ▼                ▼
       ┌───────────┐          ┌─────────┐    ┌─────────────┐
       │ Execute!  │          │ Error   │    │Apply Updates│
       └───────────┘          └─────────┘    └──────┬──────┘
                                                     │
                                                     └─► Loop
```

**Argument Extraction**:

Uses dual strategy:
1. **LLM-powered**: Call `extractArgumentsWithLLM()` for natural language parsing
2. **Manual parsing**: Fallback to simple key:value or markdown extraction

**Confirmation Phase** (if `needConfirmation !== false`):
1. Build narrative summary using `buildNarrative()`
2. Optional: Generate LLM explanation of what will happen
3. Display parameters
4. Read user response
5. Classify intent:
   - "accept", "yes", "ok" → Execute
   - "cancel", "stop", "no thanks" → Abort
   - Changes/updates → Parse and apply, loop again

---

#### 3.3 **messages.mjs**

Generates user-facing messages and prompts.

**Location**: `SkilledAgents/executor/messages.mjs`

**Key Functions**:

**`buildMissingMessage(context, validation)`**:
Constructs prompts when arguments are missing or invalid.

Example output:
```
Ignored values for Equipment Type because they did not match the expected format.

To continue I need the following details:
• Equipment Id — The unique identifier for the equipment.
  Options:
    - EQ-001
    - EQ-002
    - EQ-003
    (showing 3 of 150 options)

Optional details you may add:
• Description — Additional notes about the equipment.
  For example:
    - "Heavy duty excavator"
    - "Portable generator"

Reply in natural language or type "cancel" to stop.
```

**`buildNarrative(context)`**:
Constructs confirmation summary before execution.

Example output:
```
📋 About to perform this action:

This operation will create a new equipment record in the system for
equipment "EQ-123" of type "plant" located in "WAREHOUSE-A". The
equipment will be registered as active and available for use.

Parameters:
• Equipment Id: EQ-123
• Equipment Type: plant
• Area Id: WAREHOUSE-A
• Status: Active

Confirm by replying "accept", "cancel", or describe any adjustments.
```

**Option Display**:
- For enumerated arguments: Shows "Options:" with definitive list
- For examples: Shows "For example:" with samples
- Limits to 10 items, shows "showing X of Y" if truncated

---

#### 3.4 **llm.mjs**

Provides LLM-powered parsing and interpretation.

**Location**: `SkilledAgents/executor/llm.mjs`

**Key Functions**:

**`extractArgumentsWithLLM(context, userMessage, { taskDescription })`**:

Constructs a detailed prompt for the LLM to extract argument values:

```javascript
const prompt = `
# Extract Argument Values

## Skill Context
Skill: add-equipment
Description: Create a new equipment record

## Current Arguments
Current arguments: { "status": "Active" }

## Needed Details
Missing required arguments:
- equipment_id (aliases: id, equipmentId) — Unique identifier (examples: EQ-001, EQ-002)

## Critical Instructions
- Extract ONLY values explicitly stated by user
- Use bullet format: - argument_name: value
- Do NOT invent or use placeholders like "your_value"
- If value not mentioned, do NOT include it
- Use snake_case for argument names
`
```

Returns parsed key-value pairs, resolving aliases to canonical names.

**`interpretConfirmationWithLLM(context, userMessage)`**:

Classifies user response as:
- `accept`: User confirmed execution
- `cancel`: User wants to abort
- `update`: User wants to modify arguments (includes parsed updates)

---

### 4. **FlexSearch Adapter**

Provides semantic search capabilities for skill discovery.

**Location**: `SkilledAgents/search/flexsearchAdapter.mjs`

**Purpose**: 
- Index skills by searchable content (name, description, arguments, roles)
- Support fuzzy matching and typo tolerance
- Rank results by relevance

**Configuration**:
```javascript
{
    tokenize: 'forward',  // Optimized for prefix matching
    bool: 'or',           // OR logic between terms (default)
    suggest: true         // Enable fuzzy suggestions
}
```

---

## Key Flows

### Flow 1: Skill Registration

```
Developer Code:
  agent.registerSkill({
    specs: {
      name: 'add-equipment',
      description: 'Create new equipment',
      arguments: {
        equipment_id: { type: 'string', description: '...' }
      },
      requiredArguments: ['equipment_id']
    },
    roles: ['manager', 'admin'],
    action: async (args) => { ... }
  })

SkilledAgent:
  ↓
SkillRegistry.registerSkill():
  1. Validate specs structure
  2. Sanitize arguments
  3. Process argument metadata:
     - Resolve validator/enumerator/resolver/presenter functions
     - Build argument aliases map
  4. Create skill record
  5. Build searchable text
  6. Add to FlexSearch index
  7. Store in Map by canonical name
```

---

### Flow 2: Skill Selection

```
User Request:
  "Add new excavator equipment"

Application Code:
  1. rankScores = agent.rankSkill(userRequest, { role: 'manager' })
     → { "add-equipment": 1, "list-equipment": 3, "update-equipment": 4 }
  
  2. skillName = agent.chooseSkillWithLLM(rankScores, { query: userRequest })

SkillRegistry.rankSkill():
  1. Query FlexSearch index with task description
  2. Get ranked results
  3. Filter by user role(s)
  4. Return top 5 with ordinal scores

SkilledAgent.chooseSkillWithLLM():
  1. Normalize rank scores to array
  2. Check API keys available
  3. Build prompt:
     - List candidate skills with descriptions
     - Include user query
     - Ask LLM to choose best match
  4. Parse LLM response
  5. Return skill name or "none"
```

---

### Flow 3: Skill Execution

```
Application Code:
  result = agent.executeSkill('add-equipment', {
    args: { equipment_id: 'EQ-999' },
    taskDescription: 'Create excavator EQ-999 in warehouse A'
  })

SkilledAgent.executeSkill():
  ↓
createExecutionContext():
  1. Get skill and action from registry
  2. Process argument definitions
  3. Load option lists (call enumerators)
  4. Build search indexes for options
  5. Create validation/resolver/presenter maps
  6. Initialize normalizedArgs = {}
  7. Apply providedArgs
  ↓
mainLoop():
  ┌─── Loop Start ───┐
  │                  │
  │ 1. Extract arguments from taskDescription via LLM
  │    → { equipment_id: 'EQ-999', area_id: 'WAREHOUSE-A' }
  │ 
  │ 2. Apply updates:
  │    context.setValue('equipment_id', 'EQ-999')
  │      → Validate, resolve, coerce
  │      → normalizedArgs.equipment_id = 'EQ-999'
  │ 
  │ 3. Check validation:
  │    context.validationState()
  │      → missingRequired: ['equipment_type']
  │ 
  │ 4. Display missing prompt:
  │    "To continue I need: Equipment Type (options: plant, vehicle, tool)"
  │ 
  │ 5. Read user input:
  │    user → "plant"
  │ 
  │ 6. Extract & apply:
  │    → { equipment_type: 'plant' }
  │ 
  │ 7. Check validation:
  │    → All required present!
  │ 
  │ 8. Display confirmation:
  │    "About to create equipment...
  │     • Equipment Id: EQ-999
  │     • Equipment Type: plant
  │     Confirm?"
  │ 
  │ 9. Read confirmation:
  │    user → "accept"
  │ 
  │ 10. Classify intent:
  │     → "accept"
  │ 
  │ 11. Return normalizedArgs
  │     
  └──────────────────┘
  ↓
Call action function:
  action({ equipment_id: 'EQ-999', equipment_type: 'plant' })
  ↓
Return result to application
```

---

### Flow 4: Argument Resolution (Detailed)

When setting an argument value, the context goes through multiple steps:

```
context.setValue('status', 'active')
  ↓
resolveArgumentKey('status')
  - Check exact match in definitionMap
  - Check case-insensitive match
  - Check aliases: 'state' → 'status'
  ↓
resolveRawValue('status', 'active')
  ↓
Get definition: { name: 'status', type: 'string', enumerator: '%statusOptions' }
  ↓
Check for custom resolver:
  - resolverMap has 'status'? No
  ↓
Check for enumerator:
  - optionEntries has 'status'? Yes
  - Options: ['Active', 'Inactive', 'Maintenance']
  ↓
resolveOption():
  - toComparable('active') = 'active'
  - Check exact match: 'active' === 'active'? No
  - Check label match: 'active' === 'Active'.toLowerCase()? Yes ✓
  - Return: { matched: true, value: 'Active' }
  ↓
Coerce by type: 'Active' (string) → 'Active'
  ↓
Validate:
  - validatorMap has 'status'? No
  - Return: { valid: true, value: 'Active' }
  ↓
Set normalizedArgs['status'] = 'Active'
Delete from invalidArgs
Return 'applied'
```

---

## Advanced Features

### 1. **Argument Aliases**

Skills can define multiple names for the same argument:

```javascript
export function argumentAliases() {
    return {
        equipment_id: ['id', 'equipmentId', 'eq_id'],
        area_id: ['location', 'area', 'locationId']
    };
}
```

Context automatically resolves aliases:
- User says: "id is EQ-123"
- Resolved to: `equipment_id: 'EQ-123'`

### 2. **Rich Option Format**

Enumerators can return rich entries:

```javascript
export async function statusOptions() {
    return [
        {
            value: 'Active',
            label: 'Active',
            description: 'Equipment is operational',
            synonyms: ['operational', 'working', 'available']
        },
        {
            value: 'Maintenance',
            label: 'Under Maintenance',
            synonyms: ['repair', 'servicing']
        }
    ];
}
```

Benefits:
- Fuzzy matching against synonyms
- Rich descriptions in prompts
- Normalized value storage

### 3. **Validator Patterns**

Validators can return multiple formats:

```javascript
// Boolean
async function validateUnique(value) {
    const exists = await checkDatabase(value);
    return !exists;  // true = valid, false = invalid
}

// Object with transformed value
async function validateAndNormalize(value) {
    const normalized = value.toUpperCase();
    const valid = /^[A-Z0-9-]+$/.test(normalized);
    return { valid, value: normalized };
}

// Transformed value (implicit valid)
async function normalize(value) {
    return value.trim().toUpperCase();
}
```

### 4. **Resolver for Lookups**

Resolvers transform user input into system values:

```javascript
export async function lookupMaterial(input) {
    // User says: "steel rebar"
    // Lookup in database by name or partial match
    const material = await database.materials.search(input);
    // Return system ID
    return material?.material_id || input;
}
```

### 5. **Presenter for Display**

Presenters format values for human consumption:

```javascript
export function presentMaterial(materialId, { context }) {
    // Look up material details
    const material = database.materials.get(materialId);
    return material 
        ? `${material.name} (${materialId})` 
        : materialId;
}
```

Display in confirmation:
```
• Material: Steel Rebar Grade 60 (MAT-001)
```

### 6. **Multi-Role Access**

Skills can be accessible to multiple roles:

```javascript
export function roles() {
    return ['operator', 'manager', 'admin'];
}
```

Ranking filters by ALL roles user has:

```javascript
const ranks = agent.rankSkill(query, { 
    roles: ['operator', 'manager']  // User has both roles
});
// Returns skills accessible to either role
```

### 7. **Cancellation Detection**

Multiple mechanisms:
- Keyword matching: "cancel", "stop", "abort", "no thanks", "never mind"
- LLM classification: Uses `llmAgent.classifyMessage()` for intent detection

### 8. **Processing Callbacks**

Track LLM operation timing:

```javascript
const agent = new SkilledAgent({
    llmAgent,
    onProcessingStart: () => console.log('🤔 Thinking...'),
    onProcessingEnd: () => console.log('✓ Done')
});
```

---

## Configuration & Customization

### Custom Prompt Reader

For different environments (CLI, web, chat):

```javascript
const customReader = async (message) => {
    // Could integrate with:
    // - readline for CLI
    // - WebSocket for web UI
    // - Chat platform API
    return await getUserInput(message);
};

const agent = new SkilledAgent({
    llmAgent,
    promptReader: customReader
});
```

### Custom Skill Registry

For specialized search or storage:

```javascript
const customRegistry = new SkillRegistry({
    flexSearchAdapter: customSearchEngine,
    indexOptions: { tokenize: 'strict', bool: 'and' }
});

const agent = new SkilledAgent({
    llmAgent,
    skillRegistry: customRegistry
});
```

---

## Integration Example

```javascript
import { LLMAgent } from 'ploinkyAgentLib/LLMAgents';
import { SkilledAgent } from 'ploinkyAgentLib/SkilledAgents';

// 1. Initialize LLM
const llm = new LLMAgent({
    apiKeys: { openai: process.env.OPENAI_API_KEY },
    defaultMode: 'fast'
});

// 2. Create skilled agent
const agent = new SkilledAgent({ llmAgent: llm });

// 3. Register skills
agent.registerSkill({
    specs: {
        name: 'create-task',
        description: 'Create a new task',
        arguments: {
            title: { 
                type: 'string', 
                description: 'Task title' 
            },
            priority: { 
                type: '%priorities',  // Enumerator
                description: 'Priority level'
            }
        },
        requiredArguments: ['title']
    },
    roles: ['user', 'admin'],
    action: async ({ title, priority }) => {
        return await database.tasks.create({ title, priority });
    },
    
    // Enumerator
    enumerators: {
        priorities: async () => ['Low', 'Medium', 'High', 'Critical']
    }
});

// 4. Execute skill from user request
const userRequest = 'I need to create a task for reviewing code';

// Rank and select
const ranks = agent.rankSkill(userRequest, { role: 'user' });
const skillName = await agent.chooseSkillWithLLM(ranks, { 
    query: userRequest 
});

// Execute
const result = await agent.executeSkill(skillName, {
    taskDescription: userRequest,
    securityContext: { user: currentUser }
});

console.log('Task created:', result);
```

---

## Error Handling

### Validation Errors

```javascript
try {
    await agent.executeSkill('add-equipment', {
        args: { equipment_id: 'INVALID!' }
    });
} catch (error) {
    // "Skill execution cancelled by user."
    // or validation loop continues until valid
}
```

### Missing Skills

```javascript
try {
    await agent.executeSkill('nonexistent-skill');
} catch (error) {
    // Error: Skill "nonexistent-skill" is not registered.
}
```

### No Access

```javascript
const ranks = agent.rankSkill('add equipment', { role: 'guest' });
// {} - empty if no skills accessible to role
```

---

## Performance Considerations

### Option Loading

Enumerators are called once during context creation:
- Large option lists are indexed with FlexSearch
- Displayed options are capped at 10
- Full lists still searchable

### Search Optimization

- FlexSearch provides fast in-memory indexing
- Forward tokenization optimized for prefix matching
- Typical search: < 1ms for 100s of skills

### LLM Call Optimization

LLM calls occur at:
1. **Skill selection**: Once per user request
2. **Argument extraction**: Once per user message (if natural language)
3. **Confirmation interpretation**: Once per confirmation response
4. **Action explanation**: Once before confirmation (optional)

Optimization: Use `mode: 'fast'` for lower latency.

---

## Best Practices

### 1. **Skill Naming**

- Use kebab-case: `add-equipment`, `list-materials`
- Be specific: `create-purchase-order` vs `create-order`
- Match user vocabulary

### 2. **Descriptions**

- Clear, action-oriented: "Create a new equipment record"
- Include context: "Allocate material from inventory to a job"
- Avoid jargon unless domain-specific

### 3. **Argument Design**

- Prefer enumerators for constrained values
- Use validators for complex rules
- Provide rich option entries with synonyms
- Use presenters for IDs that need context

### 4. **Confirmation Strategy**

- Set `needConfirmation: true` for:
  - Mutating operations (create, update, delete)
  - Operations with significant impact
  - Operations that can't be undone
  
- Set `needConfirmation: false` for:
  - Read-only queries
  - Safe operations
  - Internal/system operations

### 5. **Role Assignment**

- Follow principle of least privilege
- Common pattern:
  - `viewer`: Read-only skills
  - `operator`: Read + basic operations
  - `manager`: Operator + advanced operations
  - `admin`: All skills

### 6. **Error Messages**

- Be specific in validators: "Equipment ID must be 5-8 characters"
- Avoid technical errors: Show user-friendly messages
- Suggest corrections: "Did you mean 'Active'?"

---

## Debugging

### Enable Debug Mode

```bash
export LLMAgentClient_DEBUG=true
```

Shows:
- LLM prompts sent
- LLM responses received
- Argument extraction details

### Inspect Context

```javascript
import { createExecutionContext } from 'ploinkyAgentLib/SkilledAgents/executor/context.mjs';

const context = await createExecutionContext({...});
console.log('Arguments:', context.normalizedArgs);
console.log('Validation:', context.validationState());
console.log('Options:', context.getOptionSamples('status'));
```

### Test Skills Independently

```javascript
// Test skill action directly
const skill = agent.getSkill('add-equipment');
const action = agent.getSkillAction('add-equipment');
const result = await action({ 
    equipment_id: 'TEST-001',
    equipment_type: 'plant' 
});
```

---

## Architecture Decisions

### Why FlexSearch?

- Fast, in-memory full-text search
- Small bundle size
- Fuzzy matching support
- No external dependencies

### Why Separate Context?

- Isolates execution state
- Enables testing without full agent
- Allows concurrent executions (different contexts)

### Why Normalize Early?

- Canonical names prevent ambiguity
- Easier validation logic
- Consistent storage format

### Why Enumerators as Functions?

- Dynamic option lists (database-driven)
- Lazy loading (only when needed)
- Access to context (user-specific options)

---

## Future Enhancements

### Potential Additions

1. **Skill Dependencies**: Skills that call other skills
2. **Transaction Support**: Rollback on failure
3. **Async Validators**: Parallel validation
4. **Streaming Responses**: Progressive output
5. **Multi-Step Skills**: Wizard-like flows
6. **Skill Versioning**: Backward compatibility
7. **Audit Logging**: Track all executions
8. **Caching Layer**: Reduce enumerator calls

---

## Summary

The **SkilledAgent** system provides a complete framework for building conversational AI agents that:

1. **Discover** the right skill using semantic search and LLM selection
2. **Collect** required arguments through natural language conversation
3. **Validate** inputs with custom logic and fuzzy option matching
4. **Confirm** actions with rich, LLM-generated explanations
5. **Execute** with full context and error handling

The architecture is modular, extensible, and production-ready, with careful attention to user experience, security (RBAC), and developer ergonomics.

---

**Related Documentation**:
- `AGENTS.md` - Development guidelines for AI coding agents
- `LLMAgents/` - LLM integration layer
- FlexSearch documentation - Search engine details

