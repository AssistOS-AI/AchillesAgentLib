/**
 * Parses a markdown response from an LLM that contains multiple file blocks.
 * @param {string} markdown - The markdown content to parse.
 * @returns {Map<string, string>} A map where keys are file paths and values are code content.
 */
export function parseMultiFileMarkdown(markdown) {
    const files = new Map();

    // Pattern 1: fenced code blocks with "file-path:" header (```javascript ... ```)
    const fencedPattern = /##\s*file-path:\s*([^\s\n]+)\s*\n+```(?:javascript|js)?\n([\s\S]+?)\n```/g;
    let match;
    while ((match = fencedPattern.exec(markdown)) !== null) {
        const filePath = match[1].trim();
        const code = match[2].trim();
        if (filePath && code) {
            files.set(filePath, code);
        }
    }

    // Pattern 2: fenced code blocks with bare filename header (## filename.mjs)
    // Some LLMs omit the "file-path:" prefix
    if (files.size === 0) {
        const bareFencedPattern = /##\s+([^\s\n]+\.(?:mjs|js|ts|mts))\s*\n+```(?:javascript|js)?\n([\s\S]+?)\n```/g;
        while ((match = bareFencedPattern.exec(markdown)) !== null) {
            const filePath = match[1].trim();
            const code = match[2].trim();
            if (filePath && code) {
                files.set(filePath, code);
            }
        }
    }

    // Pattern 3: unfenced — code follows the header directly (no ``` markers)
    // Only try this if no fenced pattern found anything
    if (files.size === 0) {
        const unfencedPattern = /##\s*file-path:\s*([^\s\n]+)\s*\n\n([\s\S]+?)(?=\n##\s*file-path:|\s*$)/g;
        while ((match = unfencedPattern.exec(markdown)) !== null) {
            const filePath = match[1].trim();
            let code = match[2].trim();
            // Strip leading/trailing code fences if partially present
            code = code.replace(/^```(?:javascript|js)?\n?/, '').replace(/\n?```$/, '').trim();
            if (filePath && code) {
                files.set(filePath, code);
            }
        }
    }

    return files;
}

/**
 * Creates a responseValidator callback that ensures the LLM response
 * contains at least one parsable code block. When passed to executePrompt,
 * this causes the invoker strategy to cascade to the next model on failure.
 * @returns {function(string): void}
 */
export function createCodeResponseValidator() {
    return (text) => {
        if (parseMultiFileMarkdown(text).size === 0) {
            throw new Error('LLM response contained no parsable code blocks');
        }
    };
}