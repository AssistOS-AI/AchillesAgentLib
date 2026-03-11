---
name: webapp-testing-lite
description: Use for quick smoke tests of static or local web pages when you only need keyword checks and a simple report. Works without Playwright by using curl and a bundled shell script. Trigger when the user asks for a lightweight, dependency-free web check or a fast confirmation that a page contains specific text.
---

# Webapp Testing Lite

## Overview
This skill performs a simple smoke test against a local static site by checking that required keywords appear in the rendered HTML. It uses a bundled script and requires no external dependencies.

## Inputs
- **web_root**: Path to the static site directory.
- **port**: Local port to serve the site on (choose an unused port).
- **keywords**: Comma-separated list of required strings.
- **report_path**: Path to write the smoke report.

## Steps
1. Ensure the site content exists under the provided `web_root`.
2. Use the `run-script` tool to execute the helper:
   - Command: `bash scripts/smoke_check.sh <web_root> <port> "keyword1,keyword2" <report_path>`
   - The script name is **smoke_check.sh** (do not invent another name).
3. Read the script output and report whether the check passed.

## Output Format
- Return a short summary sentence.
- Mention the report path.
