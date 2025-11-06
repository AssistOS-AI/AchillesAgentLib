# Timeline Planner

Break down schedules into phased actions and supporting summaries.

## Instructions
- Detect references to timeline, milestones, or scheduling.
- Ask the outline skill to produce a concise plan.
- Reuse the requirements skill when clarification is needed.

## Allowed Skills
- draft-outline-code
- capture-requirements-interactive

## LightSOPLang
@clarify capture-requirements-interactive $input "Clarify requested timeline details" clarification
@outline draft-outline-code $input "Produce milestone oriented outline" timeline
