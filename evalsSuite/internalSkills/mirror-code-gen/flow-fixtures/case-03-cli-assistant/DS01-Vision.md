# DS Structure Profile

## Vision and Problem Statement
Terminal users need a CLI that can call popular OpenAI-format LLMs and provide guidance grounded in the current system context. Without a clear system context profile, guidance becomes generic and ignores real machine constraints.

The intended future state is a CLI assistant that captures relevant system signals, normalizes them into a stable profile, and uses that profile to provide context-aware guidance.

## Intended Users and Context of Use
Developers, DevOps engineers, and technical operators use the CLI while actively working in terminal sessions. They need fast, trustworthy guidance without repeatedly describing their environment.

## Scope and Boundaries
This DS defines system context capture and normalization for the CLI. It does not define provider API behavior, output rendering, or tool execution workflows.

## Success Criteria
- System context is captured deterministically for a given machine state.
- Normalized context is concise, stable, and safe for prompt usage.
- The context profile can be reused across multiple provider calls without re-collection.

## Affected Files
- ./specs/system/SystemContextProfile.mjs.md - exports: SystemContextProfile : normalized context structure; ContextCapturePlan : capture steps; ContextSignalMap : signal map
