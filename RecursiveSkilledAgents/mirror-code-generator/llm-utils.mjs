/**
 * Parses a markdown response from an LLM that contains multiple file blocks.
 * @param {string} markdown - The markdown content to parse.
 * @returns {Map<string, string>} A map where keys are file paths and values are code content.
 */
export function parseMultiFileMarkdown(markdown) {
    const files = new Map();
    const fileBlockPattern = /##\s*file-path:\s*([^\s]+)\s*\n+```javascript\n([\s\S]+?)\n```/g;
    let match;
    while ((match = fileBlockPattern.exec(markdown)) !== null) {
        const filePath = match[1].trim();
        const code = match[2].trim();
        if (filePath && code) {
            files.set(filePath, code);
        }
    }
    return files;
}

/**
 * Safely parse a JSON response from the LLM.
 * @param {any} response
 * @param {string} label
 * @returns {object}
 */
export function parseJsonResponse(response, label) {
    if (response && typeof response === 'object') {
        return response;
    }
    if (typeof response !== 'string') {
        throw new Error(`${label} response is not JSON or string.`);
    }
    try {
        return JSON.parse(response);
    } catch (error) {
        throw new Error(`${label} response could not be parsed as JSON: ${error.message}`);
    }
}

/**
 * Build a multi-file text block for LLM prompts.
 * @param {Map<string, string>} generatedFiles
 * @returns {string}
 */
export function buildGeneratedFilesBlock(generatedFiles) {
    let output = '';
    for (const [filePath, code] of generatedFiles.entries()) {
        output += `\n\n## file-path: ${filePath}\n\n\`\`\`javascript\n${code}\n\`\`\``;
    }
    return output.trim();
}
