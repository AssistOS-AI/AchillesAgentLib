/**
 * @module prompts
 * This module provides functions to build prompts for the CodeSpecificationSubsystem.
 */

/**
 * Builds the prompt to extract structured arguments from a user's natural language prompt.
 * @param {string} userPrompt - The natural language prompt from the user.
 * @param {string} inputFormat - The ## Input Format section from the csskill.md file.
 * @returns {string} The complete prompt for the LLM.
 */
export function buildArgumentExtractionPrompt(userPrompt, inputFormat) {
  return `
You are a highly intelligent AI assistant specialized in parsing user requests.
Your task is to extract structured arguments from a user's prompt based on a given specification.

**Input Format:**
---
${inputFormat}
---

**User Prompt:**
---
"${userPrompt}"
---

Based on the format, parse the user prompt and extract the arguments into a valid JSON object.
The JSON object should have a single key "args", which contains the extracted arguments.
If the user prompt does not contain the required information, return a JSON object with "error" key.

Example of a valid response:
{"args": {"userObject": {"firstName": "Jane", "lastName": "Doe", "age": 25}}}

Your response must be only the JSON object.

JSON response:
`;
}

/**
 * Builds the prompt to generate executable JavaScript code based on skill specifications.
 * @param {object} specifications - An object containing all parsed sections from the csskill.md file.
 * @param {object} args - The structured arguments extracted from the user prompt.
 * @param {string} externalSpecsContent - A string containing the content of all external spec files.
 * @returns {string} The complete prompt for the LLM.
 */
export function buildCodeGenerationPrompt(specifications, args, externalSpecsContent) {
  const {
    summary,
    inputFormat,
    outputFormat,
    constraints,
    examples,
  } = specifications;

  return `
You are a senior software developer and your role is to create self-contained Javascript ESM code.
Your absolute source of truth and blueprint for the code is the following set of specifications. You must adhere to them strictly.

--- BEGIN SPECIFICATIONS BLUEPRINT ---
${externalSpecsContent}
--- END SPECIFICATIONS BLUEPRINT ---

Now, using this blueprint, generate the code while respecting the following I/O formats and constraints.

Your output MUST be valid markdown with "## file-path:" headers for each file. The main entrypoint MUST be "index.mjs" exporting an "action" function.
The code you generate must be in English.

# Skill Summary
${summary}

## Input Format
The 'action' function in 'index.mjs' will receive an object 'args' with the following structure, which has already been parsed from the user's prompt.
\`\`\`json
${JSON.stringify(args, null, 2)}
\`\`\`

Here is the original specification for the input format:
---
${inputFormat}
---

## Output Format
The 'action' function must return a value that conforms to this specification.
---
${outputFormat}
---

## Constraints
You MUST adhere to the following constraints during code generation.
---
- Only use built-in Node.js modules. Do not use any external npm packages that would require an 'npm install'.
${constraints ? `- ${constraints}` : ''}
---

## Examples
Here are some examples of input arguments and their expected output to guide you.
---
${examples}
---

Now, based on the blueprint and all the I/O specifications provided above, generate the complete, self-contained, and correct Javascript ESM code in the specified markdown format.
`;
}