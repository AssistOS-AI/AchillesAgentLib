# DS Structure Profile

## Vision and Problem Statement
The CLI must turn user intent and system context into guidance that is actionable, consistent, and provider-agnostic. Without a guidance composition contract, responses vary across models and lose reliability.

## Intended Users and Context of Use
Used internally by the CLI orchestration layer during interactive terminal sessions.

## Scope and Boundaries
Defines guidance composition rules and output structure. It does not define provider transport or UI rendering.

## Success Criteria
- Guidance composition is deterministic for the same intent and context.
- Output includes clear next-step recommendations aligned with the current system.
- The contract remains stable across different OpenAI-format providers.

## Affected Files
./specs/guidance/GuidanceComposer.mjs.md - Defines guidance composition rules and output contract.  
Exports - GuidanceComposer, GuidancePlan, GuidanceRecommendation.
