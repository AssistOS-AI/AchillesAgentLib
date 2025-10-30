# Planner Orchestrator

This orchestrator coordinates logistics reporting and MCP lookups.

## Instructions

- Analyse the request and split it into intents.
- Prefer the reporting skill for summarisation tasks.
- Use the data MCP skill when raw records are required before reporting.
- Reorder or drop steps when they do not help the user.

## Allowed Skills

- report
- data

## Intents

- reporting: Prepare human readable summaries or status updates.
- data-fetch: Retrieve underlying inventory or operational records.
