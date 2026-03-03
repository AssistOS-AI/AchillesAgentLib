# DS Structure Profile

A Global DS (Domain Specification) file is the minimal top-level document that fixes the project’s intent and boundaries. It is not a comprehensive specification and should not try to anticipate every aspect of delivery. Its role is to provide a stable, non-code reference point that remains valid even as implementation details change, while delegating depth to other DS files such as requirements DS, data DS, security DS, or integrations DS.

Accordingly, a Global DS should always contain only the sections that are universally necessary.

## Vision and Problem Statement

Explain, in plain language, what problem exists, why it matters, and what “better” looks like after the project succeeds. State the primary value proposition and intended outcome, avoiding solution design.

## Intended Users and Context of Use

Identify who the system is for and the environment in which it will be used. Keep this high level, covering personas or roles and the usage setting, sufficient to ground later decisions without drifting into UI or process details.

## Scope and Boundaries

State what the product is responsible for and, equally important, what it is not responsible for. This anchors scope and clarifies assumptions and dependencies at a conceptual level, such as reliance on an existing identity provider or expectations about source data.

## Success Criteria

Define the conditions under which the project is considered successful. These should be outcome oriented and, where feasible, measurable, while remaining free of implementation specifics. If measurement is not yet possible, state observable indicators of success and how they would be assessed.

## Affected Files

This section is required. List the FDS files that relate to this DS and provide a short description of what each will export at a high level. Use the format:

`- ./path/to/file - exports: functionA(args) : short description; functionB(args) : short description`

Rules:
- Use `exports:` exactly once per line.
- Separate exports with `;`.
- If a file has no meaningful exports, write `exports: none`.
- Keep descriptions short and high-level; do not list input/output details here.

An FDS (File Design Specification) is a concise technical spec for a single source file that defines its responsibilities and external contract. Keep this section as an implementation plan for the upcoming FDS set and avoid method input or output details.
