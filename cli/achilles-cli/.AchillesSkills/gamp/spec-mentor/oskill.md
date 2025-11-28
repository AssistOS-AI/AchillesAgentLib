# spec-mentor

Guide the user through the URS/FS/NFS/DS/test stack before committing to changes.

## Summary
- Reads the current specifications (truncated) and educates the user about how each layer should evolve.
- Proposes URS, FS, NFS, DS, and test updates as bullet ideas that the user can approve or tweak.
- Emphasises traceability and embedded verification so downstream skills can act on the agreed plan.

## Instructions
- Always load `.specs` and highlight how requirements flow across documents.
- Ask the user to confirm or adjust the proposed plan before taking further automated actions.
- Output JSON-friendly guidance so other orchestrators can reuse the recommendations when approved.
