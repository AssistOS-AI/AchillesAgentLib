---
name: docx-lite
description: Use for lightweight document drafting when a plain-text template is sufficient. Trigger when the user wants a structured memo or report without needing actual .docx output.
---

# DOCX Lite

## Overview
This skill creates structured text documents based on a bundled template. It does not generate real .docx files.

## Inputs
- **title**: Document title.
- **summary**: One-paragraph summary.
- **action_items**: 2-4 bullet items.

## Steps
1. Use `get-resource` to read `resources/doc_template.txt`.
2. Replace the placeholders with the user-provided content.
3. Return the filled template as plain text.

## Notes
- Do not ask follow-up questions if the prompt already includes title, summary, and action items.

## Output Format
- Return the completed template exactly, with headings preserved.
