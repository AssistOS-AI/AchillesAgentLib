# DBTableSkillsSubsystem

An AI-powered database table management subsystem that generates and maintains data handling functions based on declarative skill descriptions.

## Overview

The DBTableSkillsSubsystem follows the same interface pattern as other subsystems in the achillesAgentLib library. It parses skill definitions from markdown files (tskill.md) and automatically generates JavaScript functions for database operations.

## Files Structure

```
DBTableSkillsSubsystem/
├── DBTableSkillsSubsystem.mjs   # Main subsystem class
├── index.mjs                     # Export module
├── SkillParser.mjs               # Markdown parsing utilities
├── FunctionGenerator.mjs         # Function generation utilities
├── example.mjs                   # Usage example
├── README.md                     # This file
└── files/                        # Sample files and documentation
    ├── DBTableSkillSubsystem_Detailed_Specs.md
    ├── DBTableSkillAgent.js
    ├── generated_customers_functions.js
    └── sample_customers_tskill.md
```

## Features

### 1. Skill Definition Parsing
- Parses tskill.md files to extract table and field definitions
- Supports multiple field attributes (aliases, validators, presenters, etc.)
- Validates skill definitions for completeness

### 2. Function Generation
- **Presenters**: Convert database values to human-readable format
- **Resolvers**: Convert human input back to database format
- **Validators**: Validate field values before operations
- **Enumerators**: Provide possible values for fields
- **Derivators**: Create computed/virtual fields

### 3. Database Operations
- **CREATE**: New record creation with validation
- **UPDATE**: Existing record modification with AI patching
- **SELECT**: Record retrieval and display
- **DELETE**: Record deletion with confirmation

### 4. Global Functions
- `selectRecords(filter)`: Query database records
- `prepareRecord(record)`: Prepare for database storage
- `validateRecord(record)`: Validate all fields
- `presentRecord(record)`: Format for human display
- `generatePKValues()`: Generate primary key values

## Interface

### Constructor

```javascript
const subsystem = new DBTableSkillsSubsystem({
    llmAgent,      // AI agent for natural language processing
    dbAdapter,     // Database adapter for operations
    config: {
        skillsPath: './skills',       // Path to skill definitions
        generatedPath: './generated'  // Path for generated code
    }
});
```

### Methods

#### prepareSkill(skillRecord)
Prepares a skill for execution by parsing its tskill.md file and generating functions.

```javascript
await subsystem.prepareSkill({
    name: 'customers',
    descriptor: { /* metadata */ },
    skillDir: './skills/customers',
    filePath: './skills/customers/tskill.md'
});
```

#### executeSkillPrompt(options)
Executes a database operation based on natural language prompt.

```javascript
const result = await subsystem.executeSkillPrompt({
    skillRecord,
    promptText: 'Show all active customers',
    options: {
        args: { prompt: 'Show all active customers' },
        sessionMemory: null
    }
});
```

## Skill Definition Format (tskill.md)

```markdown
# TableName Skill

## Table Purpose
Description of what this table stores

## Fields

### field_name

#### Description
Basic field description and data type

#### Aliases
["alternative_name", "other_name"]

#### Field Value Presenter
How to display this value to users

#### Field Value Resolver
How to convert user input to database format

#### Field Value Validator
Validation rules for this field

#### Field Value Is Required
When this field is mandatory

#### PrimaryKey
Primary key generation strategy
```

## Integration

The DBTableSkillsSubsystem integrates seamlessly with the achillesAgentLib framework:

1. **Follows Standard Interface**: Same constructor and method signatures as other subsystems
2. **LLM Integration**: Uses the provided LLMAgent for AI operations
3. **Database Agnostic**: Works with any database through the adapter pattern
4. **Caching Support**: Caches generated functions for performance

## Usage Example

```javascript
import { DBTableSkillsSubsystem } from './DBTableSkillsSubsystem.mjs';

// Initialize subsystem
const subsystem = new DBTableSkillsSubsystem({
    llmAgent: myLLMAgent,
    dbAdapter: myDBAdapter
});

// Prepare skill
await subsystem.prepareSkill(skillRecord);

// Execute operation
const result = await subsystem.executeSkillPrompt({
    skillRecord,
    promptText: 'Create a new customer named John Doe',
    options: {}
});
```

## Benefits

1. **Declarative Approach**: Define data structure in markdown, not code
2. **Auto-Generated Functions**: Reduces boilerplate code
3. **AI-Powered Operations**: Natural language database interactions
4. **Consistent Interface**: Same pattern as other achillesAgentLib subsystems
5. **Maintainable**: Separated concerns with modular architecture

## Future Enhancements

- Database migration support
- Bulk operations (bulkCreate, bulkUpdate)
- Advanced relationship management
- Field-level security and encryption
- Performance optimization hints
- Auto-generated tests