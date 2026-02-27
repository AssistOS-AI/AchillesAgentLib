# FDS Structure Profile

An FDS (File Design Specification) is a concise technical blueprint for a single source file. It defines the file's responsibilities, boundaries, and externally visible contract, so that implementation can be done consistently and reviewed objectively. It is used when you want a file to be created, refactored, or reviewed with clear intent, stable interfaces, and minimal ambiguity.

Use these required sections in this exact order:

1. Description
2. Dependencies
3. Main Functions or Methods
4. Exports
5. Implementation Details

## Section Guidance

Description: Thoroughly describe the file’s purpose, responsibilities, and role in the system. State the artifact type such as class, utility module, adapter, interface, CLI command, schema, or configuration loader, and clarify what the file explicitly does not do.

Dependencies: List all dependencies, separating internal from external. Include exact import paths and explain why each dependency is required. Note any constraints such as no heavy dependencies, no network I/O, or deterministic behavior.

Main Functions or Methods: Enumerate the key functions or methods with their exact names. For each, specify inputs including types, shapes, invariants, outputs, possible errors or exceptions, edge cases, and expected behavior. Provide sufficient detail to implement correctly, including any algorithms or decision rules when relevant.

Exports: Describe exactly what the file exports and how consumers should use it. Include the public surface area, stability expectations, and any backward-compatibility constraints.

Implementation Details: Provide general implementation rules and constraints such as performance targets, logging or telemetry, error handling conventions, security or privacy considerations, concurrency model, idempotency, and testing expectations.

Include signatures in code blocks for key functions or methods. If a section has no content, explicitly state so.
