---
name: csv-filter
description: Use for filtering CSV rows based on a numeric threshold on a column. Trigger when the user wants to keep only rows where a column value meets a condition.
---

# CSV Filter

## Overview
This skill filters rows in a CSV file using a bundled Python script with no external dependencies.

## Inputs
- **input_csv**: Path to the input CSV file.
- **column_name**: The header of the numeric column to filter on.
- **min_value**: Minimum value (inclusive). Rows with values below this are removed.
- **output_csv**: Path to write the filtered CSV.

## Steps
1. Confirm the input file, column name, minimum value, and output path.
2. Use the `run-script` tool to execute:
   - Command: `python3 scripts/filter_rows.py <input_csv> <output_csv> <column_name> <min_value>`
   - The script name is **filter_rows.py** (do not invent another name).
3. Report the number of rows kept and the output path.

## Notes
- Do not ask follow-up questions if the prompt already includes all inputs.
- Do not attempt to filter the CSV yourself; always use the script.

## Output Format
- A short sentence with the number of rows kept.
- Mention the output file path.
