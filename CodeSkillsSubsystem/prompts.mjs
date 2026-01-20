/**
 * @module prompts
 * This module provides functions to build prompts for the CodeSkillsSubsystem.
 */

/**
 * Builds the prompt to extract structured arguments from a user's natural language prompt.
 * @param {string} userPrompt - The natural language prompt from the user.
 * @param {string} inputFormat - The ## Input Format section from the cskill.md file.
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