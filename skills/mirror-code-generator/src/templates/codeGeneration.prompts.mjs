function buildSingleFileCodePrompt({
    targetPath,
    specForPrompt,
    backupSpecForPrompt,
    existingCodeForFile,
}) {
    return `
# Single-File Code Generation Request

You are an expert JavaScript programmer. Generate the full source code for a single ECMAScript module (ESM) based on the provided specification.

## Module Specification
${specForPrompt}

## Previous Specification (from specs/.backup)
${backupSpecForPrompt || 'No previous spec was available.'}

## Existing Code Context
${existingCodeForFile || 'No existing code was available for this file.'}

## INSTRUCTIONS
- Use the exact relative file path implied by the spec (no extra prefixes like the source directory name).
- Compare current spec with previous spec when available, and focus changes on the parts that differ.
- Preserve existing behavior and structure where the spec is unchanged and the current code already works.
- If the current spec and existing code already implement the same behavior, return the existing code without changes.
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

Provide the code for the file derived from the specification.
`;
}

export { buildSingleFileCodePrompt };
