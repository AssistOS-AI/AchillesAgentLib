# DS Structure Profile

## Vision and Problem Statement
We need a CLI orchestration layer that receives user intent, gathers system context, composes guidance, and routes requests to popular OpenAI-format LLM providers. Without a clear orchestration contract, the CLI becomes brittle and provider-specific.

## Intended Users and Context of Use
Used internally by the CLI runtime during interactive terminal sessions. It must be responsive and predictable across different environments.

## Scope and Boundaries
This DS defines the prompt orchestration and provider routing surface. It does not define UI rendering or external provider SDK internals.

## Success Criteria
- User requests are translated into provider-agnostic prompt plans.
- Provider routing is consistent and configurable.
- Orchestration failures return actionable error messages.

## Affected Files
- ./specs/cli/CommandSurface.mjs.md - exports: CommandSurface : captures CLI intent; CommandRequest : normalized request; CommandResponse : structured response

- ./specs/orchestration/PromptOrchestrator.mjs.md - exports: PromptOrchestrator : builds prompt plans; OrchestrationPlan : plan model; PromptAssemblyResult : assembled prompt

- ./specs/llm/ProviderGateway.mjs.md - exports: ProviderGateway : provider router; ProviderRequest : model call input; ProviderResponse : model call output
