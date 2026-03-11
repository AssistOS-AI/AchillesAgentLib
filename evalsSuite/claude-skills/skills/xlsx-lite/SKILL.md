---
name: xlsx-lite
description: Use for simple spreadsheet-like tasks that can be handled as CSV or TSV without external libraries. Trigger when the user wants basic totals, column edits, or formatting-free tabular output.
---

# XLSX Lite

## Overview
This skill treats spreadsheets as CSV files and performs simple transforms using a bundled Python script with no external dependencies.

## Inputs
- **input_csv**: Path to the input CSV file.
- **column_name**: The header of the numeric column to total.
- **output_csv**: Path to write the updated CSV with a Totals row.

## Steps
1. Confirm the input file and column name.
2. Use the `run-script` tool to execute:
   - Command: `python3 scripts/sum_column.py <input_csv> <output_csv> <column_name>`
   - The script name is **sum_column.py** (do not invent another name).
3. Report the total and the output path.

## Output Format
- A short sentence with the total value.
- Mention the output file path.
