# Format Converter

Converts data between formats: JSON, CSV, markdown table, or plain text summary.

## Instructions

Given data and a target format, convert the data accordingly.

Supported conversions:
- JSON to CSV: output comma-separated values with a header row
- JSON to markdown: output a markdown table with | delimiters
- JSON to text: output a plain-text summary of each record
- CSV to JSON: parse CSV and output a JSON array of objects

Always clearly label the output format. For CSV, start with the header row.
For markdown tables, include the header separator row (|---|---|).

## Input Format

- data: The source data to convert
- format: Target format (csv, markdown, text, json)
