/**
 * Code Generation Prompts
 * Prompts used by the generate-code skill for generating .mjs code from skill definitions
 */

/**
 * Build the prompt for code generation from a tskill definition
 * @param {string} skillName - The name of the skill
 * @param {string} content - The full skill definition content
 * @param {Object} sections - Parsed sections from the skill definition
 * @returns {string} The prompt for the LLM
 */
export function buildCodeGenPrompt(skillName, content, sections) {
    return `Generate JavaScript/ESM code for a database table skill based on this definition.

## Skill Name: ${skillName}

## Skill Definition:
${content}

## Requirements:
1. Generate clean, modern ESM code (export functions, no CommonJS)
2. Include all validators defined in the skill
3. Include all enumerators defined in the skill
4. Include all presenters defined in the skill
5. Include all resolvers defined in the skill
6. Include a selectRecords function for filtering
7. Include a prepareRecord function for pre-DB transformation
8. Include a validateRecord function for full record validation
9. Use JSDoc comments for documentation
10. Export all functions individually AND as a default object

## Expected Exports:
- validator_<fieldName>(value, record) - returns error string or empty/null if valid
- enumerator_<fieldName>() - returns array of allowed values
- presenter_<fieldName>(value) - returns formatted display value
- resolver_<fieldName>(humanValue, record) - converts human input to DB format
- selectRecords(records, filters) - filters array of records
- prepareRecord(record) - transforms record before DB insert
- validateRecord(record) - validates entire record, returns {valid, errors}

## Code Style:
- Use arrow functions for simple operations
- Use async/await if needed
- Handle null/undefined gracefully
- Return meaningful error messages

Generate ONLY the JavaScript code, no markdown code blocks, no explanations.`;
}

/**
 * Build the prompt for code generation from an iskill definition
 * @param {string} skillName - The name of the skill
 * @param {string} content - The full skill definition content
 * @param {Object} sections - Parsed sections from the skill definition
 * @returns {string} The prompt for the LLM
 */
export function buildIskillCodeGenPrompt(skillName, content, sections) {
    return `Generate JavaScript/ESM code for an interactive skill based on this definition.

## Skill Name: ${skillName}

## Skill Definition:
${content}

## Requirements:
1. Generate clean, modern ESM code (export functions and objects, no CommonJS)
2. Export a \`specs\` object containing skill metadata and argument definitions
3. Export an async \`action\` function that implements the skill logic
4. The action function should use the LLM when appropriate via context.llmAgent

## Expected Structure:

\`\`\`javascript
/**
 * ${skillName} - Interactive Skill
 * [Description from the skill definition]
 */

export const specs = {
    name: '${skillName}',
    description: '[From Summary section]',
    needConfirmation: false, // Set to false if "needConfirmation: false" in Settings section
    arguments: {
        // Each argument from "Commands" or "Arguments" section
        // Arguments in square brackets like [topic] are optional (required: false)
        argumentName: {
            description: 'What this argument is for',
            type: 'string', // optional: string, number, boolean, date
            required: true, // false if argument is in square brackets like [argName]
            // Optional properties:
            // validator: (value) => error string or null,
            // enumerator: async () => ['option1', 'option2'],
            // llmHint: 'Hint for LLM when collecting this argument',
        },
    },
};

export async function action(args, options = {}) {
    const { llmAgent, contextManager } = options;

    // Extract arguments
    const { arg1, arg2 } = args;

    // Implement skill logic
    // Use llmAgent.executePrompt() if LLM interaction is needed

    // Return result string or object
    return 'Result of the skill execution';
}

export default { specs, action };
\`\`\`

## Prompt Section Interpretation:
The "## Prompt" section in the skill definition tells the LLM HOW to behave when executing.
If present, use it as the system prompt when calling llmAgent.executePrompt().

## Code Style:
- Use arrow functions for simple operations
- Use async/await for LLM calls
- Handle missing arguments gracefully
- Return meaningful results
- Include JSDoc comments

## Important:
- Parse the "Commands" or "Arguments" section to build the arguments object
- Arguments in square brackets like [topic] are OPTIONAL (required: false)
- Use the "Prompt" section content as guidance for the action implementation
- If the skill needs LLM, call: await llmAgent.executePrompt(prompt, { mode: 'fast' })
- Parse the "Settings" section for configuration:
  - If "needConfirmation: false" is present, set specs.needConfirmation = false
  - This allows the skill to execute immediately without user confirmation
- Parse the "Instructions" section for execution behavior guidance

Generate ONLY the JavaScript code, no markdown code blocks, no explanations.`;
}

/**
 * Build the prompt for code generation from an oskill (orchestrator) definition
 * @param {string} skillName - The name of the skill
 * @param {string} content - The full skill definition content
 * @param {Object} sections - Parsed sections from the skill definition
 * @returns {string} The prompt for the LLM
 */
export function buildOskillCodeGenPrompt(skillName, content, sections) {
    return `Generate JavaScript/ESM code for an orchestrator skill based on this definition.

## Skill Name: ${skillName}

## Skill Definition:
${content}

## Requirements:
1. Generate clean, modern ESM code (export functions and objects, no CommonJS)
2. Export a \`specs\` object containing skill metadata
3. Export an async \`action\` function that handles orchestration logic
4. Parse "Allowed-Skills" section to know which skills can be called
5. Parse "Intents" section to understand routing patterns
6. Use the "Instructions" section as guidance for the LLM when routing

## Expected Structure:

\`\`\`javascript
/**
 * ${skillName} - Orchestrator Skill
 * [Description from the skill definition]
 */

export const specs = {
    name: '${skillName}',
    description: '[From Summary section]',
    type: 'orchestrator',
    allowedSkills: ['skill1', 'skill2'], // From Allowed-Skills section
    intents: {
        // From Intents section
        intentName: 'Description of this intent',
    },
};

export async function action(input, context) {
    const { llmAgent, skilledAgent } = context;

    // Use LLM to determine intent and route to appropriate skill
    const instructions = \`[From Instructions section]\`;

    const routingPrompt = \`\${instructions}

User request: \${input}

Determine the intent and which skill to use. Return JSON:
{"intent": "...", "skill": "...", "input": "..."}\`;

    const routing = await llmAgent.executePrompt(routingPrompt, {
        responseShape: 'json',
        mode: 'fast',
    });

    // Execute the routed skill
    if (routing.skill && specs.allowedSkills.includes(routing.skill)) {
        return await skilledAgent.executeSkill({
            skillName: routing.skill,
            input: routing.input,
            context,
        });
    }

    return 'Could not determine appropriate action';
}

export default { specs, action };
\`\`\`

## Code Style:
- Use arrow functions for simple operations
- Use async/await for all skill calls
- Handle routing errors gracefully
- Include JSDoc comments

Generate ONLY the JavaScript code, no markdown code blocks, no explanations.`;
}

/**
 * Build the prompt for code generation from a cskill (code) definition
 * @param {string} skillName - The name of the skill
 * @param {string} content - The full skill definition content
 * @param {Object} sections - Parsed sections from the skill definition
 * @returns {string} The prompt for the LLM
 */
export function buildCskillCodeGenPrompt(skillName, content, sections) {
    const llmMode = sections['LLM-Mode'] || sections['LLM Mode'] || 'fast';

    return `Generate JavaScript/ESM code for a code skill based on this definition.

## Skill Name: ${skillName}

## Skill Definition:
${content}

## Requirements:
1. Generate clean, modern ESM code (export functions and objects, no CommonJS)
2. Export a \`specs\` object containing skill metadata and argument definitions
3. Export an async \`action\` function that executes the skill logic
4. The "Prompt" section defines what the LLM should do - use it as the system prompt
5. Parse "Arguments" section to define expected inputs

## Expected Structure:

\`\`\`javascript
/**
 * ${skillName} - Code Skill
 * [Description from Summary section]
 */

export const specs = {
    name: '${skillName}',
    description: '[From Summary section]',
    type: 'code',
    llmMode: '${llmMode.trim().toLowerCase()}',
    arguments: {
        // From Arguments section
        input: {
            description: 'Primary input for the skill',
            type: 'string',
            required: true,
        },
    },
};

export async function action(input, context) {
    const { llmAgent } = context;

    if (!llmAgent) {
        throw new Error('LLM agent required for code skill execution');
    }

    // The prompt from the skill definition
    const systemPrompt = \`[From Prompt section]\`;

    // Build the full prompt with user input
    const fullPrompt = \`\${systemPrompt}

User input: \${typeof input === 'string' ? input : JSON.stringify(input)}\`;

    // Execute with the specified LLM mode
    const result = await llmAgent.executePrompt(fullPrompt, {
        mode: specs.llmMode,
    });

    return result;
}

export default { specs, action };
\`\`\`

## Code Style:
- Use arrow functions for simple operations
- Use async/await for LLM calls
- Handle missing input gracefully
- Include JSDoc comments
- Use the LLM mode specified in the skill definition (${llmMode.trim().toLowerCase()})

Generate ONLY the JavaScript code, no markdown code blocks, no explanations.`;
}

export default {
    buildCodeGenPrompt,
    buildIskillCodeGenPrompt,
    buildOskillCodeGenPrompt,
    buildCskillCodeGenPrompt,
};
