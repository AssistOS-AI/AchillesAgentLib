# Specification Matrix

This matrix lists the current AchillesAgentLib DS files. The existing DS set predates the stricter GAMP frontmatter convention, so this file preserves the current filenames instead of renaming legacy specifications.

| Specification | Title | Status | Summary |
| --- | --- | --- | --- |
| [DS000](DS000-MainAgent.md) | MainAgent | current | Main orchestration entrypoint, skill discovery, session lifecycle, and execution routing. |
| [DS001](<DS001-Skill Discovery.md>) | Skill Discovery | current | Skill discovery rules and descriptor loading behavior. |
| [DS002](<DS002-Execution and Sessions.md>) | Execution and Sessions | current | Runtime execution model and session behavior. |
| [DS003](<DS003-Logging and Supervision.md>) | Logging and Supervision | current | Logging and supervised execution contracts. |
| [DS004](DS004-LLMAgent.md) | LLMAgent | current | Shared LLM abstraction used by the agent runtime. |
| [DS005](<DS005-Agentic Session.md>) | Agentic Session | current | Agentic session lifecycle and execution constraints. |
| [DS006](DS006-CodeSkillsSubsystem.md) | CodeSkillsSubsystem | current | Code skill descriptor, build, and execution behavior. |
| [DS007](DS007-Subsystems.md) | Subsystems | current | Shared subsystem interface and lifecycle. |
| [DS008](DS008-AgenticKnowledgeUnits.md) | Agentic Knowledge Units | draft | Deterministic local-first Knowledge Unit storage, indexing, search, and ContextPack construction. |
