# spec-review

Inspect URS/FS/NFS/DS/test artifacts and surface risks before execution.

## Summary
- Reads the current `.specs` snapshot and asks the LLM reviewer to highlight gaps.
- Returns severity-tagged findings with concrete recommendations plus any missing tests.
- Feeds the results into follow-up orchestrators (update-specs, refactor, etc.).

## Instructions
- Always mention requirement identifiers (URS/FS/NFS/DS) when possible.
- Prioritise GxP/GAMP expectations: traceability, validation evidence, auditability.
- Keep the output structured JSON so the user can approve or route to other skills.
