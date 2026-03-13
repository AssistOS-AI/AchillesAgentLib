---
name: text-stats
description: Use for computing basic text statistics such as word count, sentence count, and character count. Trigger when the user wants quantitative analysis of a text passage.
---

# Text Stats

## Overview
This skill computes basic text statistics using a bundled Python script with no external dependencies.

## Inputs
- **input_file**: Path to a text file to analyze.

## Steps
1. Confirm the input file path.
2. Use the `run-script` tool to execute:
   - Command: `python3 scripts/text_stats.py <input_file>`
   - The script name is **text_stats.py** (do not invent another name).
3. Return the statistics exactly as printed by the script.

## Notes
- Do not ask follow-up questions if the prompt already includes the file path.
- Do not attempt to compute the statistics yourself; always use the script.

## Output Format
- Return the script output verbatim. The script prints lines like:
  ```
  words: 42
  sentences: 5
  characters: 230
  avg_word_length: 4.8
  ```
