function buildFdsPrompt({ template, dsContent, targetPath, existingFds }) {
    return `
# FDS Generation Request

You are an expert technical writer. Generate a File Design Specification (FDS) for the target file.
Follow the required structure exactly as shown in the template.

## Template
${template}

## Source DS
${dsContent}

## Target FDS File
${targetPath}

## Existing FDS (if any)
${existingFds || 'No existing FDS available.'}

## Instructions
- Output the full FDS markdown only.
- Use the required sections in the exact order.
- Do not use code blocks for function signatures; keep them inline.
- If a section has no content, explicitly state so.
- Dependencies must use the strict one-line format: \`path/to/file - functionName : reason\` (reason is required).
- Do not list npm packages or Node.js built-ins under Dependencies; describe those in Implementation Details instead.
- Main Functions must use \`-\` as the item separator and may be multiline; do not start description lines with \`-\`.
- Main Functions must be detailed enough to be reused by other FDS files (clear inputs, outputs, behavior, and errors).
`;
}

export { buildFdsPrompt };
