# SkilledAgent Development Guidelines for AI Coding Agents

## 🚨 CRITICAL: Required Reading

**Before making ANY changes to the SkilledAgent system, you MUST read and understand:**

### **`SKILLEDAGENT-ARCHITECTURE.md`**

This document is **mandatory reading** and provides:
- Complete system architecture and component interactions
- Detailed flow diagrams for skill registration, selection, and execution
- Argument resolution pipeline (validators, enumerators, resolvers, presenters)
- Execution context structure and lifecycle
- Interactive mainLoop flow for argument collection
- LLM integration patterns
- Best practices and design patterns

**WITHOUT reading this documentation, you WILL introduce bugs, break conventions, and create code that doesn't integrate properly with the system.**

---

## Coding Standards & Conventions

### File Format & Module System

- **Always use `.mjs` file extension** for all JavaScript modules
- **ES6+ module syntax only**: Use `import`/`export`
- **Never use CommonJS**: No `require()` or `module.exports`

```javascript
// ✅ Correct
import { SkilledAgent } from './SkilledAgents/SkilledAgent.mjs';
import { createExecutionContext } from './SkilledAgents/executor/context.mjs';

export { SkilledAgent };
export default SkilledAgent;

// ❌ Wrong
const SkilledAgent = require('./SkilledAgents/SkilledAgent.mjs');
module.exports = SkilledAgent;
```

---

### ES6+ Syntax Requirements

Use modern JavaScript features throughout:

```javascript
// Arrow functions
const normalize = (value) => value?.trim() || '';

// Async/await (never use .then() chains)
async function executeSkill(name, args) {
    const context = await createExecutionContext({ skill, action, args });
    return await mainLoop(context);
}

// Destructuring
const { skill, action, llmAgent } = context;
const { name, description, arguments: argDefs } = skill.specs;

// Template literals
const message = `Skill "${skillName}" registered with ${argCount} arguments`;

// Spread operator
const updatedContext = { ...context, normalizedArgs: { ...args } };

// Optional chaining
const firstArg = skill?.arguments?.[0]?.name;

// Nullish coalescing
const mode = options.mode ?? 'fast';

// Array methods
const requiredArgs = definitions.filter(def => def.required);
const argNames = definitions.map(def => def.name);
```

---

### Code Formatting

#### Indentation
- **4 spaces** (not tabs)
- Consistent across all files

```javascript
// ✅ Correct: 4 spaces
function registerSkill(config) {
    if (!config.specs) {
        throw new Error('Missing specs');
    }
    return this.registry.add(config);
}

// ❌ Wrong: 2 spaces or tabs
function registerSkill(config) {
  if (!config.specs) {
    throw new Error('Missing specs');
  }
  return this.registry.add(config);
}
```

#### Trailing Commas
- Always use trailing commas in multi-line objects and arrays
- Improves git diffs and reduces merge conflicts

```javascript
// ✅ Correct
const skill = {
    name: 'add-equipment',
    description: 'Create equipment',
    arguments: {
        equipment_id: { type: 'string' },
        status: { type: 'string' },
    },
    requiredArguments: ['equipment_id'],
};

const items = [
    'first',
    'second',
    'third',
];

// ❌ Wrong
const skill = {
    name: 'add-equipment',
    description: 'Create equipment',
    arguments: {
        equipment_id: { type: 'string' },
        status: { type: 'string' }  // ← Missing comma
    },
    requiredArguments: ['equipment_id']  // ← Missing comma
};
```

#### Quotes
- Single quotes for strings (except template literals)
- Template literals for string interpolation

```javascript
// ✅ Correct
const name = 'add-equipment';
const message = `Registered skill: ${name}`;

// ❌ Wrong
const name = "add-equipment";  // Double quotes
const message = 'Registered skill: ' + name;  // String concatenation
```

#### Semicolons
- Always use semicolons at statement ends
- Prevents ASI (Automatic Semicolon Insertion) issues

```javascript
// ✅ Correct
const skill = getSkill('add-equipment');
return skill.action(args);

// ❌ Wrong
const skill = getSkill('add-equipment')
return skill.action(args)
```

---

## Testing Requirements

### Test-Driven Development

**Every bug fix and feature addition MUST include corresponding tests.**

### Test File Location & Structure

Tests should be organized alongside the code they test:

```
ploinkyAgentLib/
├── SkilledAgents/
│   ├── SkilledAgent.mjs
│   ├── SkillRegistry.mjs
│   ├── executor/
│   │   ├── context.mjs
│   │   ├── mainLoop.mjs
│   │   ├── messages.mjs
│   │   └── llm.mjs
│   ├── search/
│   │   └── flexsearchAdapter.mjs
│   └── tests/
│       ├── run-tests.mjs          ← Test runner
│       ├── skilled-agent.test.mjs
│       ├── skill-registry.test.mjs
│       ├── executor-context.test.mjs
│       ├── executor-mainloop.test.mjs
│       └── utils/
│           └── test-helpers.mjs
├── LLMAgents/
│   └── LLMAgent.mjs
├── SKILLEDAGENT-ARCHITECTURE.md
└── AGENTS.md
```

### Test Naming Convention

```javascript
// Test files: *.test.mjs
// Test functions: export function test<DescriptiveName>()

export async function testSkillRegistrationRequiresSpecs() {
    // Test implementation
}

export async function testArgumentResolutionWithAliases() {
    // Test implementation
}

export async function testMainLoopHandlesCancellation() {
    // Test implementation
}
```

### When to Write Tests

#### 1. For Bug Fixes
```javascript
// 1. Write a failing test that reproduces the bug
export async function testPlaceholderDetectionRejectsYourPrefix() {
    const context = await createTestContext();
    context.normalizedArgs.job_name = 'your_job_name';
    
    // This should fail initially (bug present)
    const hasValue = context.hasValue('job_name');
    assertEqual(hasValue, false, 'Should reject placeholder values starting with "your"');
}

// 2. Fix the bug in SkilledAgents/executor/context.mjs
// 3. Run test - it should now pass
// 4. Commit both fix and test together
```

#### 2. For New Features
```javascript
// Write tests BEFORE implementing the feature

export async function testRichOptionFormatWithSynonyms() {
    const options = [
        {
            value: 'Active',
            label: 'Active',
            synonyms: ['operational', 'working'],
        },
    ];
    
    const context = await createTestContext({ options });
    
    // Test exact match
    let result = await context.resolveRawValue('status', 'Active');
    assertEqual(result.success, true);
    assertEqual(result.value, 'Active');
    
    // Test synonym match
    result = await context.resolveRawValue('status', 'operational');
    assertEqual(result.success, true);
    assertEqual(result.value, 'Active');
}

// Then implement the feature
```

#### 3. For Refactoring
```javascript
// Ensure existing tests pass after refactoring
// Add new tests if refactoring changes behavior or adds capabilities

export async function testArgumentResolutionPerformance() {
    const context = await createTestContext({
        optionCount: 1000,  // Large option list
    });
    
    const startTime = Date.now();
    for (let i = 0; i < 100; i++) {
        await context.resolveRawValue('item', `ITEM-${i}`);
    }
    const duration = Date.now() - startTime;
    
    // Should complete in reasonable time even with large option lists
    assert(duration < 1000, `Resolution took ${duration}ms, expected < 1000ms`);
}
```

---

## Running Tests

### Always run tests before committing changes:

```bash
# Run all tests
node SkilledAgents/tests/run-tests.mjs

# Run specific test suite
node SkilledAgents/tests/run-tests.mjs --suite skilled-agent

# Run with verbose output
node SkilledAgents/tests/run-tests.mjs --verbose

# Run without cleanup (for debugging)
node SkilledAgents/tests/run-tests.mjs --no-cleanup
```

### Critical Testing Scenarios

**Run the full test suite whenever you modify:**

1. **`SkilledAgents/SkilledAgent.mjs`**
   - Skill registration/execution flow
   - LLM integration
   - Prompt reader integration

2. **`SkilledAgents/SkillRegistry.mjs`**
   - Skill storage and retrieval
   - Search indexing
   - Argument metadata processing
   - Role-based filtering

3. **`SkilledAgents/executor/context.mjs`**
   - Execution context creation
   - Argument resolution
   - Validation pipeline
   - Option matching (enumerators)
   - Placeholder detection

4. **`SkilledAgents/executor/mainLoop.mjs`**
   - Interactive argument collection
   - Confirmation flow
   - Cancellation handling
   - LLM argument extraction

5. **`SkilledAgents/executor/messages.mjs`**
   - User prompt generation
   - Missing argument messages
   - Confirmation narratives

6. **`SkilledAgents/executor/llm.mjs`**
   - LLM prompt construction
   - Argument extraction from natural language
   - Confirmation interpretation

7. **`LLMAgents/LLMAgent.mjs`** (dependency)
   - Markdown parsing
   - Message classification
   - Complete method

8. **`SkilledAgents/search/flexsearchAdapter.mjs`**
   - Semantic search
   - Ranking algorithm

---

## Test Structure & Utilities

### Test Helpers

Create reusable test utilities:

```javascript
// SkilledAgents/tests/utils/test-helpers.mjs

export function assertEqual(actual, expected, message = '') {
    if (actual !== expected) {
        const error = new Error(message || `Expected ${expected}, got ${actual}`);
        error.actual = actual;
        error.expected = expected;
        throw error;
    }
}

export function assert(condition, message = 'Assertion failed') {
    if (!condition) {
        throw new Error(message);
    }
}

export async function assertThrows(fn, expectedMessage = null) {
    let threw = false;
    let error = null;
    
    try {
        await fn();
    } catch (err) {
        threw = true;
        error = err;
    }
    
    if (!threw) {
        throw new Error('Expected function to throw an error');
    }
    
    if (expectedMessage && !error.message.includes(expectedMessage)) {
        throw new Error(`Expected error message to include "${expectedMessage}", got "${error.message}"`);
    }
}

export async function createTestContext(options = {}) {
    // Create a minimal execution context for testing
    const skill = {
        name: 'test-skill',
        description: 'Test skill',
        arguments: options.arguments || {
            test_arg: { type: 'string', description: 'Test argument' },
        },
        requiredArguments: options.requiredArguments || ['test_arg'],
    };
    
    const action = async (args) => ({ success: true, ...args });
    
    return await createExecutionContext({
        skill,
        action,
        providedArgs: options.providedArgs || {},
        llmAgent: options.llmAgent || createMockLLMAgent(),
        securityContext: options.securityContext || null,
    });
}

export function createMockLLMAgent() {
    return {
        complete: async ({ prompt }) => 'Mock response',
        parseMarkdownKeyValues: (text) => ({}),
        interpretMessage: async (text) => ({ intent: 'accept' }),
        classifyMessage: (text) => ({ intent: 'accept' }),
    };
}
```

### Example Test Suite

```javascript
// SkilledAgents/tests/executor-context.test.mjs

import { createExecutionContext } from '../executor/context.mjs';
import { assertEqual, assert, assertThrows, createTestContext } from './utils/test-helpers.mjs';

export async function testContextCreationRequiresSkill() {
    await assertThrows(
        async () => await createExecutionContext({ action: () => {} }),
        'requires a skill definition'
    );
}

export async function testContextCreationRequiresAction() {
    await assertThrows(
        async () => await createExecutionContext({ skill: {} }),
        'requires an executable action'
    );
}

export async function testContextHasValueDetectsPlaceholders() {
    const context = await createTestContext();
    
    // Set placeholder value
    context.normalizedArgs.test_arg = 'your_test_arg';
    
    // Should detect as invalid placeholder
    const hasValue = context.hasValue('test_arg');
    assertEqual(hasValue, false, 'Should reject placeholder values');
}

export async function testContextSetValueAppliesCoercion() {
    const context = await createTestContext({
        arguments: {
            is_active: { type: 'boolean', description: 'Active status' },
        },
    });
    
    // Set string "true"
    await context.setValue('is_active', 'true');
    
    // Should coerce to boolean
    assertEqual(typeof context.normalizedArgs.is_active, 'boolean');
    assertEqual(context.normalizedArgs.is_active, true);
}

export async function testContextResolveRawValueWithEnumerator() {
    const statusOptions = [
        { value: 'Active', label: 'Active', synonyms: ['operational'] },
        { value: 'Inactive', label: 'Inactive', synonyms: ['disabled'] },
    ];
    
    const context = await createTestContext({
        arguments: {
            status: {
                type: 'string',
                description: 'Status',
                enumerator: async () => statusOptions,
            },
        },
    });
    
    // Load options (normally done in createExecutionContext)
    // For this test, we need to manually trigger it
    
    // Test synonym match
    const result = await context.resolveRawValue('status', 'operational');
    assertEqual(result.success, true);
    assertEqual(result.value, 'Active');
}

export async function testContextValidationState() {
    const context = await createTestContext({
        arguments: {
            name: { type: 'string' },
            description: { type: 'string' },
        },
        requiredArguments: ['name'],
    });
    
    // Initially missing required
    let state = context.validationState();
    assertEqual(state.valid, false);
    assertEqual(state.missingRequired.length, 1);
    assertEqual(state.missingRequired[0], 'name');
    
    // Set required argument
    await context.setValue('name', 'Test');
    
    state = context.validationState();
    assertEqual(state.valid, true);
    assertEqual(state.missingRequired.length, 0);
}

export async function testContextAliasResolution() {
    const skill = {
        name: 'test-skill',
        description: 'Test skill',
        arguments: {
            equipment_id: { type: 'string' },
        },
        requiredArguments: ['equipment_id'],
        argumentAliases: {
            equipment_id: ['id', 'equipmentId', 'eq_id'],
        },
    };
    
    const context = await createExecutionContext({
        skill,
        action: async () => ({}),
        providedArgs: {},
        llmAgent: null,
    });
    
    // Set via alias
    await context.setValue('id', 'EQ-123');
    
    // Should resolve to canonical name
    assertEqual(context.normalizedArgs.equipment_id, 'EQ-123');
    assert(!Object.prototype.hasOwnProperty.call(context.normalizedArgs, 'id'));
}
```

---

## Common Patterns & Best Practices

### 1. Error Handling

```javascript
// ✅ Use descriptive error messages
if (!skillName || typeof skillName !== 'string') {
    throw new Error('executeSkill requires a non-empty skill name string.');
}

const skill = this.registry.getSkill(skillName);
if (!skill) {
    throw new Error(`Skill "${skillName}" is not registered. Use registerSkill() first.`);
}

// ❌ Generic errors
if (!skillName) {
    throw new Error('Invalid input');
}
```

### 2. Validation

```javascript
// ✅ Validate early, fail fast
function normalizeSkillName(name) {
    if (typeof name !== 'string') {
        return '';
    }
    return name.trim().toLowerCase();
}

function sanitizeSpecs(specs) {
    if (!specs || typeof specs !== 'object') {
        throw new TypeError('Skill specifications must be provided as an object.');
    }
    
    if (!specs.name || typeof specs.name !== 'string') {
        throw new Error('Skill specification requires a "name" string.');
    }
    
    // ... more validation
}

// ❌ Assume valid input
function sanitizeSpecs(specs) {
    return {
        name: specs.name,
        description: specs.description,
        // ... might crash if specs is null
    };
}
```

### 3. Async/Await

```javascript
// ✅ Proper async/await usage
async function loadOptions(definitions) {
    const results = new Map();
    
    for (const def of definitions) {
        if (typeof def.enumerator === 'function') {
            try {
                const options = await Promise.resolve(def.enumerator());
                results.set(def.name, options);
            } catch (error) {
                console.warn(`Failed to load options for "${def.name}":`, error.message);
            }
        }
    }
    
    return results;
}

// ❌ Mixing callbacks and promises
function loadOptions(definitions) {
    const results = new Map();
    
    definitions.forEach(def => {
        def.enumerator().then(options => {
            results.set(def.name, options);
        }).catch(error => {
            console.warn(error);
        });
    });
    
    return results;  // ← Won't wait for promises
}
```

### 4. Immutability

```javascript
// ✅ Don't mutate input parameters
function applyDefaults(options) {
    return {
        mode: 'fast',
        limit: 5,
        ...options,  // Override defaults with provided options
    };
}

// ❌ Mutating input
function applyDefaults(options) {
    options.mode = options.mode || 'fast';
    options.limit = options.limit || 5;
    return options;
}
```

### 5. Null Safety

```javascript
// ✅ Use optional chaining and nullish coalescing
const description = skill?.specs?.description ?? 'No description';
const firstArg = skill?.arguments?.[0]?.name;

if (options?.verbose) {
    console.log('Verbose mode enabled');
}

// ❌ Nested checks
const description = skill && skill.specs && skill.specs.description 
    ? skill.specs.description 
    : 'No description';

if (options && options.verbose) {
    console.log('Verbose mode enabled');
}
```

---

## Documentation Standards

### JSDoc Comments

Add JSDoc for public APIs:

```javascript
/**
 * Execute a registered skill with provided arguments.
 * 
 * @param {string} skillName - The name of the skill to execute
 * @param {Object} options - Execution options
 * @param {Object} options.args - Initial argument values
 * @param {string} options.taskDescription - Natural language task description
 * @param {Object} options.securityContext - User/role information
 * @returns {Promise<any>} The result from the skill action
 * @throws {Error} If skill is not registered or execution fails
 */
async executeSkill(skillName, { args = {}, taskDescription = '', securityContext = null } = {}) {
    // Implementation...
}
```

### Inline Comments

Comment complex logic:

```javascript
// Check for placeholder strings that LLMs might generate
const normalized = trimmed.toLowerCase().replace(/[_\s-]/g, '');

// Detect common placeholders
const placeholderKeywords = [
    'notprovided',
    'notset',
    'missing',
    'unknown',
];

// Check for generic 'your*' patterns that might not match the field name
// This catches patterns like 'your_job_name', 'yourjobname', etc.
if (normalized.startsWith('your') && normalized.length > 4) {
    return false;
}
```

---

## Commit Guidelines

### Commit Message Format

Use present-tense verb format with descriptive messages:

```
✅ Good:
- Add synonym matching to option resolution
- Fix placeholder detection for 'your*' patterns
- Update mainLoop to skip confirmation when needConfirmation is false
- Add tests for argument alias resolution
- Refactor context creation to improve performance

❌ Bad:
- added feature
- fixed bug
- WIP
- updates
- changes
```

### Commit Organization

Group related changes:

```bash
# Feature with tests
git add SkilledAgents/executor/context.mjs SkilledAgents/tests/executor-context.test.mjs
git commit -m "Add rich option format support with synonyms and descriptions

- Extend normalizeOptionEntries to handle rich option objects
- Add synonym matching in resolveOption
- Update buildOptionDetail to show descriptions
- Add tests for rich option format resolution"

# Bug fix with test
git add SkilledAgents/executor/context.mjs SkilledAgents/tests/executor-context.test.mjs
git commit -m "Fix placeholder detection rejecting valid 'your' values

- Update hasValue() to be more precise in 'your*' detection
- Only reject if pattern looks like a placeholder (length check)
- Add test cases for edge cases"
```

---

## Architecture Principles

### Follow Existing Patterns

Before adding new features, understand existing patterns:

1. **Read `SKILLEDAGENT-ARCHITECTURE.md`** thoroughly
2. Study similar existing code
3. Follow established conventions
4. Maintain consistency

### Separation of Concerns

```javascript
// ✅ Each module has clear responsibility
// SkilledAgents/SkilledAgent.mjs - Orchestration
// SkilledAgents/SkillRegistry.mjs - Storage & search
// SkilledAgents/executor/context.mjs - Execution state
// SkilledAgents/executor/mainLoop.mjs - User interaction
// SkilledAgents/executor/messages.mjs - UI text generation
// SkilledAgents/executor/llm.mjs - AI integration

// ❌ Mixing concerns
// Don't put LLM logic in context.mjs
// Don't put storage logic in mainLoop.mjs
```

### Extensibility

Design for extension:

```javascript
// ✅ Support custom implementations
class SkilledAgent {
    constructor({ 
        llmAgent, 
        skillRegistry = null,  // Allow custom registry
        promptReader = null,   // Allow custom prompt reader
    } = {}) {
        this.skillRegistry = skillRegistry instanceof SkillRegistry 
            ? skillRegistry 
            : new SkillRegistry();
        
        this.promptReader = typeof promptReader === 'function'
            ? promptReader
            : defaultPromptReader;
    }
}

// ❌ Hard-coded dependencies
class SkilledAgent {
    constructor({ llmAgent } = {}) {
        this.skillRegistry = new SkillRegistry();
        this.promptReader = readline.createInterface(...);  // ← Can't customize
    }
}
```

---

## Debugging

### Enable Debug Mode

```bash
export LLMAgentClient_DEBUG=true
node your-script.mjs
```

Shows:
- LLM prompts being sent
- LLM responses received
- Argument extraction details
- Validation flow

### Test Individual Components

```javascript
// Test context independently
import { createExecutionContext } from './SkilledAgents/executor/context.mjs';

const context = await createExecutionContext({
    skill: { /* ... */ },
    action: async (args) => ({ ...args }),
    providedArgs: { test: 'value' },
    llmAgent: null,
});

console.log('Arguments:', context.normalizedArgs);
console.log('Validation:', context.validationState());
```

### Use Verbose Test Mode

```bash
node SkilledAgents/tests/run-tests.mjs --verbose
```

Shows:
- Individual test execution
- Error details and stack traces
- Test timing information

---

## Summary Checklist

Before submitting changes, verify:

- [ ] **Read `SKILLEDAGENT-ARCHITECTURE.md`** completely
- [ ] Used `.mjs` extension for all files
- [ ] Used ES6+ syntax throughout (no CommonJS)
- [ ] 4-space indentation consistently
- [ ] Trailing commas in multi-line structures
- [ ] Single quotes for strings (except template literals)
- [ ] Semicolons at statement ends
- [ ] Written tests for new features or bug fixes
- [ ] Run **full test suite** with `node SkilledAgents/tests/run-tests.mjs`
- [ ] All tests pass
- [ ] Followed existing architecture patterns
- [ ] Added JSDoc comments for public APIs
- [ ] Used descriptive variable/function names
- [ ] Validated inputs and handled errors properly
- [ ] Used optional chaining and nullish coalescing
- [ ] Commit message follows present-tense format
- [ ] Changes are focused and well-organized

### LLM Planning Reliability
- Never synthesize fallback specifications when the LLM planner is offline or returns no actions. Surface the error instead so the operator can refine the prompt or rerun when the planner is available.
- Prompts should nudge the LLM to behave like a seasoned architect: reusing existing specs, avoiding duplicates, and honoring GAMP traceability rules.

---

## Getting Help

1. **Read the architecture doc first**: `SKILLEDAGENT-ARCHITECTURE.md`
2. **Check existing code**: Look for similar implementations
3. **Run tests**: `node SkilledAgents/tests/run-tests.mjs --verbose`
4. **Enable debug mode**: `export LLMAgentClient_DEBUG=true`
5. **Test components independently**: Import and test individual modules

---

**Remember: Quality over speed. Take time to understand the architecture, write comprehensive tests, and follow established patterns. The SkilledAgent system is production-grade code that requires production-grade development practices.**
