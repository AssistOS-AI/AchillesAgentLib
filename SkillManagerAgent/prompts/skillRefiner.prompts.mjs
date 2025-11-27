/**
 * Skill Refiner Prompts
 * Prompts used by the skill-refiner skill for evaluating and fixing skill definitions
 */

/**
 * Build the prompt for evaluating test results against requirements
 * @param {*} testResult - The result from running tests
 * @param {Object} requirements - The requirements to check against
 * @returns {string} The prompt for the LLM
 */
export function buildEvaluationPrompt(testResult, requirements) {
    return `Evaluate if this test result meets the requirements.

## Requirements:
${JSON.stringify(requirements, null, 2)}

## Test Result:
${typeof testResult === 'string' ? testResult : JSON.stringify(testResult, null, 2)}

## Instructions:
Analyze if the test passed and meets all requirements.
Identify any failures or issues that need to be fixed.

Respond in JSON format:
{
    "success": true/false,
    "failures": [
        { "section": "Section Name", "field": "field_name", "reason": "what went wrong" }
    ],
    "suggestions": ["suggestion 1", "suggestion 2"]
}`;
}

/**
 * Build the prompt for generating fixes based on failures
 * @param {string} skillContent - The current skill definition content
 * @param {Array} failures - Array of failure objects from evaluation
 * @param {Array} history - Array of previous iteration results
 * @returns {string} The prompt for the LLM
 */
export function buildFixesPrompt(skillContent, failures, history) {
    const historyContext = history.map((h, i) =>
        `Iteration ${i + 1}: ${h.evaluation?.failures?.map(f => f.reason).join(', ') || 'No failures recorded'}`
    ).join('\n');

    return `You need to fix a skill definition based on test failures.

## Current Skill Definition:
${skillContent}

## Failures to Fix:
${JSON.stringify(failures, null, 2)}

## Previous Attempts:
${historyContext || 'This is the first attempt'}

## Instructions:
1. Analyze each failure
2. Determine which sections need to be modified
3. Generate the fixed content for each section

Respond in JSON format:
{
    "fixes": [
        {
            "section": "Section Name",
            "content": "The new content for this section"
        }
    ],
    "explanation": "Brief explanation of what was fixed"
}`;
}

export default {
    buildEvaluationPrompt,
    buildFixesPrompt,
};
