# Project Router

Route complex project prompts to specialised skills that gather requirements and compute numeric deltas.

## Instructions
- Identify descriptive parts of the task and capture them via the requirements skill.
- Forward quantitative or estimation content to the computation skill.
- Provide concise prompts that match the downstream capability.

## Allowed Skills
- capture-requirements-interactive
- compute-delta-code

## LightSOPLang
@prompt prompt
@capture capture-requirements-interactive $prompt "Collect requirements context" discovery
@compute compute-delta-code $prompt "Estimate numeric deltas or calculations" estimation
