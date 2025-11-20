# Agent Session Evaluation Suite

This directory contains test cases for evaluating the `startAgentSession` LLM Agent primitive.

## Overview

The `startAgentSession` primitive creates an agentic session that can handle multiple prompts in sequence, maintaining context and tool call history across interactions.

### Method Signature

```javascript
const session = await agent.startAgentSession(tools, initialPrompt);
// session has a newPrompt method for follow-up interactions
await session.newPrompt(followUpPrompt);
```

### Parameters

- `tools`: Object with tool descriptions and handler functions
- `initialPrompt`: String containing the first instruction
- Returns: `LLMAgentSession` object with `newPrompt` method

## Test Case Structure

Each test case is a JSON file with the following structure:

```json
{
  "description": "Human-readable description of the test case",
  "tools": {
    "toolName": "Tool description with arguments"
  },
  "prompts": [
    "Initial prompt text",
    "Follow-up prompt 1",
    "Follow-up prompt 2"
  ],
  "expectedVariables": {
    "label1": "expected_value_1",
    "label2": "expected_value_2"
  }
}
```

## Running the Evaluation

```bash
cd evalsSuite
node evalAgent Session.mjs
```

## Current Test Cases

1. **case_01_simple.json**: Basic single prompt with tool call
2. **case_02_multi_turn.json**: Multi-turn conversation with context
3. **case_03_context_memory.json**: Tests context retention across prompts
4. **case_04_error_recovery.json**: Error handling and recovery
5. **case_05_complex_workflow.json**: Complex multi-step workflow

## Implementation Notes

The evaluation script calls `agent.agenticPlanAndExecute(tools, initialPrompt)` and uses the returned session object (with `newPrompt` and `getVariables`) to drive multi-turn agentic workflows.

## Evaluation Criteria

- Session creation without errors
- Successful execution of multiple prompts
- Context maintenance across prompts
- Proper tool call sequencing
- Error handling and recovery