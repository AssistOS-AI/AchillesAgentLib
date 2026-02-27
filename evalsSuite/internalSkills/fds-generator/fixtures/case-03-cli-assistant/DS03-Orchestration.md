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

## Pointers to Supporting DS Files
- DS01-Vision.md for system context profiling.
- DS02-Guidance.md for guidance composition.

## Affected Files
./specs/cli/CommandSurface.mjs.md - Defines the CLI command surface and intent capture contract.  
Exports - CommandSurface, CommandRequest, CommandResponse.

./specs/orchestration/PromptOrchestrator.mjs.md - Defines the orchestration contract for assembling prompts and coordinating providers.  
Exports - PromptOrchestrator, OrchestrationPlan, PromptAssemblyResult.

./specs/llm/ProviderGateway.mjs.md - Defines the provider gateway for OpenAI-format model calls.  
Exports - ProviderGateway, ProviderRequest, ProviderResponse.
