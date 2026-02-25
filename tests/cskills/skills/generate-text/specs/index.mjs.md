# Generate Text Skill Specification

## Overview
This skill generates text content using an LLM agent based on a specified prompt and context. It accepts different execution modes to adjust reasoning depth. The skill returns the generated text upon success or throws errors for invalid parameters or LLM failures.

## Interface
- **Input**: A prompt string in the format `"prompt: text, context: text, mode: deep|fast"`.
- **Output**: A string of generated text.

## Dependencies
- LLM agent (for text generation).