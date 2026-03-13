---
name: meeting-notes
description: Use for converting raw meeting transcripts or summaries into structured meeting notes. Trigger when the user provides meeting content and wants organized notes with attendees, discussion points, action items, and decisions.
---

# Meeting Notes

## Overview
This skill converts raw meeting text into structured notes. It does not use any tools; it processes the input directly.

## Inputs
- **transcript**: Raw meeting text, summary, or bullet points.

## Steps
1. Extract attendee names from the text.
2. Identify key discussion topics.
3. Extract action items (who does what by when).
4. Note any decisions made.
5. Format everything using the required output format.

## Notes
- Do not ask follow-up questions if the prompt already includes the meeting content.
- Do not call any tools for this skill; produce the notes directly.
- If attendee names are not mentioned, use "Not specified" for Attendees.

## Output Format
Use this exact format:
```
## Attendees
- <name 1>
- <name 2>

## Discussion Points
1. <topic 1>
2. <topic 2>

## Action Items
- [ ] <person>: <task> (by <date if mentioned>)

## Decisions
- <decision 1>
- <decision 2>
```
