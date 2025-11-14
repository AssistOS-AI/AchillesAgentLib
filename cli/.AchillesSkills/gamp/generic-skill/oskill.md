# generic-skill

Adaptive orchestrator that handles open-ended workspace edits when no specialised skill fits.

## Summary
- Produces a short tool-based plan using the LLM.
- Tools: `list-files`, `read-file`, `rewrite-file`, `replace-text`.
- Executes the plan sequentially and reports each step.

## Instructions
- Always keep file operations inside the provided workspace root.
- Prefer `rewrite-file` for holistic updates; fall back to `replace-text` for small patches.
- Include the rationale for each step in the plan so logs explain what is happening.
