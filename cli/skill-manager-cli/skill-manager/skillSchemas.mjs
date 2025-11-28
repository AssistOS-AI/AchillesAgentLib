/**
 * Skill Schema Definitions
 * Defines the structure, required sections, and templates for each skill type
 */

export const SKILL_TYPES = {
    tskill: {
        fileName: 'tskill.md',
        generatedFileName: 'tskill.generated.mjs',
        description: 'Database table skill - defines entity schema with fields, validators, and business rules',
        requiredSections: ['Table Purpose', 'Fields'],
        optionalSections: ['Derived Fields', 'Business Rules', 'Relationships'],
    },
    cskill: {
        fileName: 'cskill.md',
        generatedFileName: null, // Uses separate .js file
        description: 'Code skill - LLM generates and executes code based on prompt',
        requiredSections: ['Summary', 'Prompt'],
        optionalSections: ['Arguments', 'LLM Mode', 'Examples'],
    },
    iskill: {
        fileName: 'iskill.md',
        generatedFileName: null,
        description: 'Interactive skill - conversational commands with user input',
        requiredSections: ['Summary', 'Commands'],
        optionalSections: ['Roles', 'Session Storage'],
    },
    oskill: {
        fileName: 'oskill.md',
        generatedFileName: null,
        description: 'Orchestrator skill - routes intents to other skills',
        requiredSections: ['Instructions', 'Allowed Skills'],
        optionalSections: ['Intent Recognition', 'Routing Logic', 'Fallback Behavior'],
    },
    mskill: {
        fileName: 'mskill.md',
        generatedFileName: null,
        description: 'MCP skill - uses Model Context Protocol tools',
        requiredSections: ['Summary', 'MCP Tools'],
        optionalSections: ['Configuration'],
    },
};

export const SKILL_TEMPLATES = {
    tskill: `# [Entity Name]

## Table Purpose
[Describe what this table stores and its role in the system]

## Fields

### field_id
- Description: Unique identifier for this record
- Type: string
- Required: true
- PrimaryKey: true
- Indexed: true
- Aliases: ["id", "record_id"]

#### Field Value Validator
Must match pattern: [ENTITY]-####  (e.g., ENTITY-0001)
Auto-generates if not provided.

### name
- Description: Human-readable name
- Type: string
- Required: true
- Indexed: true
- Aliases: ["title", "label"]

#### Field Value Validator
- Minimum length: 2 characters
- Maximum length: 100 characters
- Must be unique within table

#### Field Value Presenter
Capitalizes first letter of each word.

### status
- Description: Current status of the record
- Type: string
- Required: true
- Default: "active"

#### Field Value Enumerator
["active", "inactive", "archived"]

#### Field Value Validator
Must be one of the enumerated values.

### description
- Description: Optional detailed description
- Type: string
- Required: false
- Aliases: ["notes", "details"]

### created_at
- Description: Timestamp when record was created
- Type: datetime
- Required: true
- Default: current timestamp

### updated_at
- Description: Timestamp of last modification
- Type: datetime
- Required: false

## Derived Fields

### is_active
- Type: boolean
- Calculation: status === "active"
- Description: Convenience field for filtering active records

### display_name
- Type: string
- Calculation: \`\${name} (\${field_id})\`
- Description: Formatted display string

## Business Rules

1. Records cannot be deleted if referenced by other entities
2. Status transitions: active → inactive → archived (one-way)
3. Name must be unique within the same parent context

## Relationships

### Parent: [ParentEntity]
- Foreign key: parent_id
- Cascade: restrict delete

### Children: [ChildEntity]
- Referenced by: parent_id in ChildEntity
- Cascade: set null on delete
`,

    cskill: `# [Skill Name]

## Summary
[One-line description of what this skill does]

## Prompt
You are a specialized assistant for [task description].

Your responsibilities:
1. [Primary responsibility]
2. [Secondary responsibility]
3. [Additional responsibility]

Input format:
- [Describe expected input]

Output format:
- [Describe expected output]

Error handling:
- [How to handle errors]

## Arguments
- input: The primary input data to process
- options: Optional configuration object
  - format: Output format (json | text | markdown)
  - verbose: Include detailed output (true | false)

## LLM Mode
fast

## Examples

### Example 1: Basic usage
Input: "example input"
Output: "example output"

### Example 2: With options
Input: { "data": "...", "options": { "format": "json" } }
Output: { "result": "..." }
`,

    iskill: `# [Skill Name]

## Summary
[One-line description of this interactive skill]

## Commands

### command_name <arg1> [arg2]
- Description: [What this command does]
- Arguments:
  - arg1 (required): [Description]
  - arg2 (optional): [Description]
- Example: \`command_name value1 value2\`

### another_command
- Description: [What this command does]
- Aliases: ["alt_name", "shortcut"]
- Example: \`another_command\`

## Roles

### admin
- Description: Full access to all commands
- Capabilities: [list of allowed commands]

### user
- Description: Limited access
- Capabilities: [list of allowed commands]

## Session Storage
- current_context: Stores the active working context
- history: Recent command history (max 10 entries)
`,

    oskill: `# [Orchestrator Name]

## Instructions
This orchestrator routes user intents to the appropriate skills.
[Additional context about the domain]

## Allowed Skills
- skill_name_1: [When to use this skill]
- skill_name_2: [When to use this skill]
- skill_name_3: [When to use this skill]

## Intent Recognition

### Intent Category 1
- Keywords: ["keyword1", "keyword2"]
- Routes to: skill_name_1
- Examples:
  - "user says this" → skill_name_1

### Intent Category 2
- Keywords: ["keyword3", "keyword4"]
- Routes to: skill_name_2
- Examples:
  - "user says that" → skill_name_2

## Routing Logic

1. Analyze the user's intent using NLP
2. Match against known intent patterns
3. Validate user has permission for the target skill
4. Execute the skill with appropriate context
5. Format and return the response

## Post-Processing Rules

- After successful operations: [what to do]
- After errors: [how to handle]
- Logging: [what to log]

## Fallback Behavior

When intent is unclear:
1. List possible interpretations
2. Ask for clarification
3. Suggest most likely option based on context
`,

    mskill: `# [MCP Skill Name]

## Summary
[One-line description of this MCP skill]

## MCP Tools

### tool_name_1
- Description: [What this tool does]
- Parameters:
  - param1: [type] - [description]
  - param2: [type] - [description]
- Returns: [description of return value]

### tool_name_2
- Description: [What this tool does]
- Parameters:
  - param1: [type] - [description]
- Returns: [description of return value]

## Configuration

### Server Connection
- URL: [MCP server URL or local path]
- Authentication: [auth method if required]

### Default Options
- timeout: 30000
- retries: 3
`,
};

/**
 * Detect skill type from file content
 * @param {string} content - The skill file content
 * @returns {string|null} - The skill type or null if unknown
 */
export function detectSkillType(content) {
    if (!content || typeof content !== 'string') {
        return null;
    }

    const contentLower = content.toLowerCase();

    // Check for table/entity indicators (tskill)
    if (contentLower.includes('## table purpose') ||
        contentLower.includes('## fields') ||
        contentLower.includes('### field value validator')) {
        return 'tskill';
    }

    // Check for orchestrator indicators (oskill)
    if (contentLower.includes('## allowed skills') ||
        contentLower.includes('## allowed-skills') ||
        contentLower.includes('## intent recognition') ||
        contentLower.includes('## routing logic')) {
        return 'oskill';
    }

    // Check for interactive indicators (iskill)
    // iskill uses "## Required Arguments" or "## Arguments" for parameter collection
    if (contentLower.includes('## required arguments') ||
        (contentLower.includes('## commands') &&
            (contentLower.includes('## roles') || contentLower.includes('## session')))) {
        return 'iskill';
    }

    // Check for MCP indicators (mskill)
    if (contentLower.includes('## mcp tools') ||
        contentLower.includes('### server connection')) {
        return 'mskill';
    }

    // Default to code skill if has summary and prompt
    if (contentLower.includes('## summary') && contentLower.includes('## prompt')) {
        return 'cskill';
    }

    return null;
}

/**
 * Validate a skill file against its schema
 * @param {string} content - The skill file content
 * @param {string} skillType - The skill type (tskill, cskill, etc.)
 * @returns {{valid: boolean, errors: string[], warnings: string[]}}
 */
export function validateSkillContent(content, skillType = null) {
    const errors = [];
    const warnings = [];

    if (!content || typeof content !== 'string') {
        return { valid: false, errors: ['Content is empty or invalid'], warnings: [] };
    }

    // Auto-detect type if not provided
    const type = skillType || detectSkillType(content);
    if (!type) {
        return { valid: false, errors: ['Could not determine skill type'], warnings: [] };
    }

    const schema = SKILL_TYPES[type];
    if (!schema) {
        return { valid: false, errors: [`Unknown skill type: ${type}`], warnings: [] };
    }

    // Check required sections
    for (const section of schema.requiredSections) {
        const sectionPattern = new RegExp(`##\\s+${section}`, 'i');
        if (!sectionPattern.test(content)) {
            errors.push(`Missing required section: ## ${section}`);
        }
    }

    // Check for title (# heading at start)
    if (!content.trim().startsWith('#')) {
        errors.push('Skill file should start with a # title');
    }

    // Check optional sections and warn if missing
    // Normalize content for comparison (treat hyphens and spaces as equivalent)
    const normalizedContent = content.toLowerCase().replace(/-/g, ' ');
    for (const section of schema.optionalSections || []) {
        const normalizedSection = section.toLowerCase().replace(/-/g, ' ');
        const sectionPattern = new RegExp(`##\\s+${normalizedSection.replace(/\s+/g, '[\\s-]+')}`, 'i');
        if (!sectionPattern.test(content)) {
            warnings.push(`Optional section not present: ## ${section}`);
        }
    }

    // Type-specific validation
    if (type === 'tskill') {
        // Check for at least one field definition
        if (!content.includes('### ')) {
            errors.push('Table skill should define at least one field (### field_name)');
        }
    }

    if (type === 'cskill') {
        // Check for LLM mode (accept both "## LLM Mode" and "## LLM-Mode")
        const hasLLMMode = /##\s+llm[\s-]+mode/i.test(content);
        if (!hasLLMMode) {
            warnings.push('Code skill should specify ## LLM Mode (fast or deep)');
        }
    }

    return {
        valid: errors.length === 0,
        errors,
        warnings,
        detectedType: type,
    };
}

/**
 * Parse sections from a skill file
 * @param {string} content - The skill file content
 * @returns {Object} - Parsed sections as key-value pairs
 */
export function parseSkillSections(content) {
    const sections = {};

    if (!content) return sections;

    // Extract title
    const titleMatch = content.match(/^#\s+(.+)$/m);
    if (titleMatch) {
        sections._title = titleMatch[1].trim();
    }

    // Extract all ## sections
    const sectionRegex = /^##\s+(.+)$\n([\s\S]*?)(?=^##\s+|\n*$)/gm;
    let match;

    while ((match = sectionRegex.exec(content)) !== null) {
        const sectionName = match[1].trim();
        const sectionContent = match[2].trim();
        sections[sectionName] = sectionContent;
    }

    return sections;
}

/**
 * Update a specific section in skill content
 * @param {string} content - Original content
 * @param {string} sectionName - Section to update (without ##)
 * @param {string} newContent - New content for the section
 * @returns {string} - Updated content
 */
export function updateSkillSection(content, sectionName, newContent) {
    const sectionRegex = new RegExp(
        `(^##\\s+${escapeRegex(sectionName)}\\s*\\n)([\\s\\S]*?)(?=^##\\s+|\\n*$)`,
        'mi'
    );

    if (sectionRegex.test(content)) {
        // Section exists, replace it
        return content.replace(sectionRegex, `$1${newContent}\n\n`);
    } else {
        // Section doesn't exist, append it
        return `${content.trim()}\n\n## ${sectionName}\n${newContent}\n`;
    }
}

function escapeRegex(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export default {
    SKILL_TYPES,
    SKILL_TEMPLATES,
    detectSkillType,
    validateSkillContent,
    parseSkillSections,
    updateSkillSection,
};
