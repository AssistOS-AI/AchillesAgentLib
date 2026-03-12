# ask-user

## Summary
Prompts the user for missing or unclear information and returns the response as plain text.

## Input Format
- **prompt** (string): The question or clarification text to show the user.
- **dependsOn** (string, optional): Dependency markers to enforce ordering; ignored by this skill.

Rules:
- The prompt is shown verbatim to the user.
- If the prompt is empty, use a generic clarification question.

## Output Format
- **Type**: `string`
- **Success Example**: "We should store specs under ./specs".
- **Error Example**: "Error: ask-user requires an interactive input reader."

## Constraints
- Requires an interactive input reader (LLMAgent inputReader).
- Does not call the LLM directly.
