---
name: json-lint
description: Use for validating JSON data against structural rules. Trigger when the user wants to check whether a JSON object has required fields, correct types, or follows a schema.
---

# JSON Lint

## Overview
This skill validates JSON text against a set of structural rules loaded from a bundled resource file.

## Inputs
- **json_text**: The JSON content as a string (may be inline or a description of the structure).

## Steps
1. Use `get-resource` to read `resources/rules.md`. This returns the content of the rules file.
2. Read the rules from the returned content. Each rule has a name and a condition.
3. Parse the JSON text provided by the user.
4. Check each rule against the parsed JSON.
5. Call `final_answer` with the validation results in the exact output format below.

**IMPORTANT**: After reading the resource, you must validate the JSON yourself based on the rules. Do NOT just return the rules file content.

## Notes
- Do not ask follow-up questions if the prompt already includes the JSON text.
- If the JSON is malformed (not parseable), output INVALID for all rules with "malformed JSON" as the reason.

## Output Format
Return ONLY the validation results in this format:
```
has_name: VALID
has_version: VALID
has_entries: VALID
entries_have_id: VALID
entries_have_label: INVALID - entry at index 0 is missing "label"
Overall: 4/5 rules passed
```
