# Generate Code

Generates .mjs code from skill definitions (tskill, iskill, oskill, cskill).

## Summary
Uses LLM to generate JavaScript code from skill definitions:
- **tskill**: Generates validators, presenters, resolvers for database table skills
- **iskill**: Generates specs and action function for interactive skills
- **oskill**: Generates specs and action function for orchestrator skills with routing logic
- **cskill**: Generates specs and action function wrapper for code skills

## Prompt
Analyze the skill definition and generate corresponding JavaScript/ESM code with all required exports.

## Arguments
- skillName: Name of the skill to generate code for (tskill, iskill, oskill, or cskill)

## LLM-Mode
deep
