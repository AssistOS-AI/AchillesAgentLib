function buildRepairPrompt({
    targetPath,
    specForPrompt,
    backupSpecForPrompt,
    generatedCodeForFile,
    failures,
    runnerCode,
}) {
    return `
# Single-File Code Repair

You are an expert JavaScript programmer. Repair the file so it satisfies the spec and fixes the reported syntax failures.
Return only one markdown block for the file.

## Module Specification
${specForPrompt}

## Previous Specification (from specs/.backup)
${backupSpecForPrompt || 'No previous spec was available.'}

## Generated Code Context
${generatedCodeForFile || 'No generated code was available for this file.'}

## Test Runner
${runnerCode || 'No test runner was provided.'}

## Failed Cases
${JSON.stringify({ failures }, null, 2)}

## INSTRUCTIONS
- Use the exact relative file path implied by the spec (no extra prefixes like the source directory name).
- Compare current spec with previous spec when available, and focus changes on the parts that differ.
- Preserve existing behavior and structure where the spec is unchanged and the current code already works.
- Specifications are authoritative. If the runner conflicts with the specifications, follow the specifications.
- When possible, keep the implementation compatible with the provided runner and test inputs.
- If the spec contains hardcoded values or exact literals, use them verbatim without modification.
- Do not generate JSDoc-style comment blocks (e.g. /** ... */ with @param/@throws tags) unless explicitly required by the spec.
- Your response **MUST** be a single markdown block for the file.
- You **MUST** use a header to specify the relative file path.
- Do not add any other text, explanations, or apologies.

### Example Response Format:

## file-path: ${targetPath}

\`\`\`javascript
// code for ${targetPath} goes here...
export const myVar = '...';
\`\`\`
`;
}

export { buildRepairPrompt };
