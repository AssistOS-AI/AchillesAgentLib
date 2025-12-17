import fs from 'node:fs/promises';
import path from 'node:path';
import { getDebugLogger } from '../utils/DebugLogger.mjs';

/**
 * Recursively finds all spec files (.md) in a directory.
 * @param {string} baseDir - The base directory to start searching from.
 * @param {string} [currentDir=''] - The current subdirectory, used for recursion.
 * @returns {Promise<Array<{relativePath: string, absolutePath: string}>>} A list of spec files with their paths.
 */
async function findSpecFiles(baseDir, currentDir = '') {
    const entries = await fs.readdir(path.join(baseDir, currentDir), { withFileTypes: true });
    let files = [];
    for (const entry of entries) {
        const relativePath = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
            files = files.concat(await findSpecFiles(baseDir, relativePath));
        } else if (entry.name.endsWith('.md') || entry.name.endsWith('.mds')) {
            files.push({
                relativePath,
                absolutePath: path.join(baseDir, relativePath),
            });
        }
    }
    return files;
}


/**
 * Helper function to get the most recent modification time of files in a directory.
 * This checks for changes in the spec files themselves.
 * @param {string} dir - The directory containing spec files.
 * @returns {Promise<number>} The timestamp of the newest spec file.
 */
async function getNewestSpecFileTime(dir) {
    let newestTime = 0;
    try {
        const specFiles = await findSpecFiles(dir);
        for (const file of specFiles) {
            const stats = await fs.stat(file.absolutePath);
            if (stats.mtimeMs > newestTime) {
                newestTime = stats.mtimeMs;
            }
        }
    } catch (error) {
        // Ignore if directory doesn't exist, etc.
    }
    return newestTime;
}

/**
 * Helper function to get the oldest modification time of files in the src directory.
 * Used to determine if any generated code file is older than the newest spec.
 * @param {string} dir - The src directory.
 * @returns {Promise<number>} The timestamp of the oldest generated file.
 */
async function getOldestSrcFileTime(dir) {
    let oldestTime = Infinity;
    try {
        const srcFiles = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of srcFiles) {
            const filePath = path.join(dir, entry.name);
            if (entry.isFile()) {
                const stats = await fs.stat(filePath);
                if (stats.mtimeMs < oldestTime) {
                    oldestTime = stats.mtimeMs;
                }
            } else if (entry.isDirectory()) {
                const nestedOldest = await getOldestSrcFileTime(filePath);
                if (nestedOldest < oldestTime) {
                    oldestTime = nestedOldest;
                }
            }
        }
    } catch (error) {
        // Directory might not exist yet, or be empty.
        return 0; // Treat as if no files exist, thus requiring regeneration.
    }
    return oldestTime;
}

/**
 * Parses a markdown response from an LLM that contains multiple file blocks.
 * @param {string} markdown - The markdown content to parse.
 * @returns {Map<string, string>} A map where keys are file paths and values are code content.
 */
function parseMultiFileMarkdown(markdown) {
    const files = new Map();
    // Regex to find '## file-path: <path>' followed by '```javascript\n<code block>\n```'
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
 * Generic skill to generate code from a 'specs' directory.
 * Gathers all specs into a single prompt and parses a multi-file response.
 *
 * @param {object} skillRecord - The skill record for which to generate code.
 * @param {object} llmAgent - The LLM agent instance to use for generation.
 * @param {object} [logger=console] - Logger instance.
 */
export async function generateCode(skillRecord, llmAgent, logger = console) {
    const debugLogger = getDebugLogger();
    const { skillDir } = skillRecord;
    const specsDir = path.join(skillDir, 'specs');
    const srcDir = path.join(skillDir, 'src');

    try {
        const srcDirExists = await fs.stat(srcDir).then(stat => stat.isDirectory()).catch(() => false);
        const specsDirExists = await fs.stat(specsDir).then(stat => stat.isDirectory()).catch(() => false);

        if (!specsDirExists) {
            debugLogger?.log('generateCode:skip', { skill: skillRecord.name, reason: 'No specs directory found.' });
            return;
        }

        let needsRegeneration = true;
        if (srcDirExists) {
            const newestSpecTime = await getNewestSpecFileTime(specsDir);
            const oldestSrcTime = await getOldestSrcFileTime(srcDir);
            // Regenerate if no spec files were found (newestSpecTime is 0), or if newest spec is newer than oldest src
            if (newestSpecTime > 0 && newestSpecTime <= oldestSrcTime) {
                needsRegeneration = false;
            }
        }

        if (!needsRegeneration) {
            debugLogger?.log('generateCode:skip', { skill: skillRecord.name, reason: 'Source code is up-to-date.' });
            return;
        }

        debugLogger?.log('generateCode:start', { skill: skillRecord.name, reason: 'Source is missing or outdated.' });

        // 1. Gather all spec files and their content for the prompt
        const specFiles = await findSpecFiles(specsDir);
        if (specFiles.length === 0) {
            logger.warn(`[generateCode] No spec files found in ${specsDir} for skill "${skillRecord.name}".`);
            return;
        }

        let specsForPrompt = '';
        for (const specFile of specFiles) {
            const content = await fs.readFile(specFile.absolutePath, 'utf-8');
            // e.g., specs/utils/parser.mjs.md -> utils/parser.mjs
            const targetPath = specFile.relativePath
                .replace(/\\/g, '/') // Normalize to forward slashes
                .replace(/\.mds?$/, '');

            specsForPrompt += `\n\n---\n# Spec for: ${targetPath}\n\n${content}`;
        }

        // 2. Build the skill context from csskill.md sections
        const sections = skillRecord.descriptor.sections || {};
        let skillContext = '';

        // Include relevant sections from csskill.md
        if (sections['Input Format']) {
            skillContext += `\n### Input Format\n${sections['Input Format']}\n`;
        }
        if (sections['Output Format']) {
            skillContext += `\n### Output Format\n${sections['Output Format']}\n`;
        }
        if (sections['Constraints']) {
            skillContext += `\n### Constraints\n${sections['Constraints']}\n`;
        }
        if (sections['Examples']) {
            skillContext += `\n### Examples\n${sections['Examples']}\n`;
        }

        // 3. Build the single, comprehensive prompt for the LLM
        const prompt = `
# Multi-File Code Generation Request

You are an expert JavaScript programmer. Your task is to generate the full source code for multiple ECMAScript modules (ESM) based on the provided specifications.

## Skill Description
- **Name:** ${skillRecord.name}
- **Summary:** ${skillRecord.descriptor.summary || 'No summary provided.'}
${skillContext}
## Module Specifications
${specsForPrompt}

## INSTRUCTIONS
Your response **MUST** be a series of markdown blocks, one for each file. For each file, you **MUST** use a header to specify the relative file path. Do not add any other text, explanations, or apologies.

### Example Response Format:

## file-path: path/to/first-file.mjs

\`\`\`javascript
// code for path/to/first-file.mjs goes here...
export const myVar = '...';
\`\`\`

## file-path: path/to/second-file.mjs

\`\`\`javascript
// code for path/to/second-file.mjs goes here...
import { myVar } from './first-file.mjs';
\`\`\`

Provide the code for all files derived from the specifications.
`;

        // 4. Call LLM to generate code
        const response = await llmAgent.executePrompt(prompt, {
            mode: 'deep',
            responseShape: 'text', // Expect a raw markdown string
            context: { intent: 'generate-multi-file-code-from-specs' },
        });

        // 5. Parse the multi-file markdown response
        const generatedFiles = parseMultiFileMarkdown(response);
        if (generatedFiles.size === 0) {
            throw new Error(`LLM did not return any parsable files. Response was: ${response.substring(0, 500)}...`);
        }

        logger.log(`[generateCode] Parsed ${generatedFiles.size} files from LLM response for skill "${skillRecord.name}".`);

        // 6. Write the generated files to the src directory
        await fs.rm(srcDir, { recursive: true, force: true }).catch(() => {}); // Clean directory
        await fs.mkdir(srcDir, { recursive: true });

        for (const [relativePath, code] of generatedFiles.entries()) {
            const outputPath = path.join(srcDir, relativePath);
            await fs.mkdir(path.dirname(outputPath), { recursive: true });
            await fs.writeFile(outputPath, code, 'utf-8');
            debugLogger?.log('generateCode:wroteFile', { skill: skillRecord.name, path: outputPath });
        }

        logger.log(`[generateCode] Successfully generated all ${generatedFiles.size} files for skill "${skillRecord.name}".`);

    } catch (error) {
        logger.error(`[generateCode] Failed to generate code for skill "${skillRecord.name}": ${error.message}`);
        debugLogger?.log('generateCode:error', { skill: skillRecord.name, error: error.stack });
    }
}