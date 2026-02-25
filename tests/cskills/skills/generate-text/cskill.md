# generate-text
Produces text content using the LLM based on prompt context.

## Summary
Produces text content using the LLM based on prompt context.

## Input Format
- **generationPrompt** (string): Primary generation prompt.
- **context** (string | array): Supporting context text.
- **mode** (string): LLM mode (e.g. "fast", "deep").

## Output Format
- **Type**: `string`
- **Success Example**: "Generated content for specs backlog..."
- **Error Example**: "Error: LLM generation failed."

## Constraints
- Ensure prompt and context are passed as plain text.
- Return only the generated text.
