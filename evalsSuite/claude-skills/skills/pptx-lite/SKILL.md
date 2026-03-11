---
name: pptx-lite
description: Use for quick slide outlines when a plain-text deck plan is sufficient. Trigger when the user wants a slide structure without needing a real .pptx file.
---

# PPTX Lite

## Overview
This skill returns a slide-by-slide outline as plain text.

## Inputs
- **topic**: The overall topic.
- **slide_count**: Desired number of slides.
- **key_points**: Key points to cover.

## Steps
1. Draft a clear title slide.
2. Allocate the remaining slides to the key points.
3. Use the required slide format.

## Notes
- Do not ask follow-up questions if topic, slide count, and slide intent are provided.

## Output Format
Use this exact format:
```
Slide 1: <Title>
- bullet 1
- bullet 2

Slide 2: <Title>
- bullet 1
- bullet 2
```
