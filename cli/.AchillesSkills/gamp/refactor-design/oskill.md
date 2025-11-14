# refactor-design

Capture refactor requests as DS updates and optionally move code stubs into new files.

## Summary
- Parses the prompt for target modules or folders.
- Updates/creates DS entries with new descriptions and file impacts.
- Invokes `build-code` so the filesystem mirrors the refreshed design.

## Instructions
- Keep existing IDs when the prompt references them (e.g., `DS-005`).
- Otherwise, create a fresh DS linked to an automatically generated URS/FS pair.
- Return the IDs touched to aid downstream orchestrations.
