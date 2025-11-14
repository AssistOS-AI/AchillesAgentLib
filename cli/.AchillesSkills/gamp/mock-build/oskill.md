# mock-build

Generate lightweight mock artefacts (CLI or HTML) that visualise the requirements captured in `.specs`.

## Summary
- Inspects `package.json` and workspace structure to guess whether to emit a CLI script or HTML screens.
- Uses the latest URS/FS/NFS content to populate the mock.
- Writes the mock into `.specs/mock`.

## Instructions
- Always refresh specs via `loadSpecs` before generating the mock.
- Keep outputs deterministic so that rebuilds are diff-friendly.
- Report the output path for downstream tooling.
