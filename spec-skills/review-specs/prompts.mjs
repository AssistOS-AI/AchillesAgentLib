export function buildReviewPrompt({ specContent, codeContent, relativePath }) {
  const checklist = `Checklist:
- Purpose and scope clearly stated.
- Inputs/outputs, parameters, return types documented.
- Control flow and edge cases covered.
- Dependencies and side effects noted.
- Consistency between spec and code.
- Missing details or contradictions.`;

  const codeBlock = codeContent ? `\n\nJS Source (full):\n\n${codeContent}` : '\n\nJS Source: not found';

  return `You are an expert project manager and specification auditor. Review JS specs for completeness and consistency.

Spec file: ${relativePath}

Spec content:\n\n${specContent}${codeBlock}\n\n${checklist}\n\nRespond with JSON: {"status": "ok|needs-info|broken", "issues": [..], "proposedFixes": [..]}`;
}
