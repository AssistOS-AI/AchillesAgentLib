---
name: pdf-lite
description: Use for simple text-based PDF checks when the PDF content is provided as plain text. Trigger for lightweight compliance checks or section validation without external PDF libraries.
---

# PDF Lite

## Overview
This skill evaluates plain-text PDF content against a checklist. It does not open real PDF files.

## Inputs
- **pdf_text**: The PDF content pasted as plain text.

## Steps
1. Use `get-resource` to read `resources/checklist.md`.
2. Check the provided text for each required item.
3. Output a PASS/FAIL line per item and a short summary.

## Notes
- Do not ask follow-up questions if the prompt already includes the PDF text.

## Output Format
- One line per checklist item: `ITEM_NAME: PASS` or `ITEM_NAME: FAIL`
- A final summary line describing overall status.
