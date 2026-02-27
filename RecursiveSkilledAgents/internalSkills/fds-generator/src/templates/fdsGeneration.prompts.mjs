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
- Include signatures in code blocks where relevant.
- If a section has no content, explicitly state so.
`;
}

export { buildFdsPrompt };
