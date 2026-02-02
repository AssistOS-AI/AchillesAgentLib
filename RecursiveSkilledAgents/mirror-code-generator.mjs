import fs from 'node:fs/promises';
import path from 'node:path';
import { getDebugLogger } from '../utils/DebugLogger.mjs';

/**
 * Short name identifier for this internal skill.
 */
export const shortName = 'mirror-code-generator';

/**
 * Descriptor metadata for this internal skill.
 */
export const descriptor = {
    title: 'Mirror Code Generator',
    summary: 'Generates JavaScript/ESM code from specs/ directory markdown files.',
    sections: {},
};

/**
 * Orchestrator skill action entry point.
 * @param {Object} context - Execution context provided by OrchestratorSkillsSubsystem.
 * @param {string} context.prompt - The skill directory path to generate code for.
 * @param {Object} context.recursiveAgent - The recursive agent instance (provides llmAgent).
 * @param {Object} context.llmAgent - The LLM agent instance.
 * @returns {Promise<Object>} Result object with message and generatedFiles array.
 */
export async function action(context) {
    const { prompt, recursiveAgent, llmAgent } = context;
    const targetDir = prompt?.trim();

    if (!targetDir) {
        throw new Error('mirror-code-generator requires a skill directory path as input.');
    }

    // Use llmAgent from context, or fall back to recursiveAgent.llmAgent
    const agent = llmAgent || recursiveAgent?.llmAgent;
    if (!agent) {
        throw new Error('mirror-code-generator requires an LLM agent.');
    }

    const generatedFiles = await generateMirrorCode(targetDir, agent, console);

    return {
        message: `Code generation completed for ${targetDir}`,
        generatedFiles: generatedFiles || [],
    };
}
/**
 * Recursively finds all spec files (.md/.mds) in a directory.
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
 * Recursively finds all files in a directory, excluding specs/ and .md files.
 * @param {string} baseDir - The base directory to start searching from.
 * @param {string} [currentDir=''] - The current subdirectory, used for recursion.
 * @returns {Promise<Array<{relativePath: string, absolutePath: string}>>} A list of files with their paths.
 */
async function findExistingCodeFiles(baseDir, currentDir = '') {
    const entries = await fs.readdir(path.join(baseDir, currentDir), { withFileTypes: true });
    let files = [];
    for (const entry of entries) {
        const relativePath = path.join(currentDir, entry.name);
        const normalizedRelPath = relativePath.replace(/\\/g, '/');
        if (entry.isDirectory()) {
            if (normalizedRelPath === 'specs' || normalizedRelPath.startsWith('specs/')) {
                continue;
            }
            files = files.concat(await findExistingCodeFiles(baseDir, relativePath));
        } else if (!entry.name.endsWith('.md') && !entry.name.endsWith('.mds')) {
            files.push({
                relativePath,
                absolutePath: path.join(baseDir, relativePath),
            });
        }
    }
    return files;
}

/**
 * Copy specs directory to specs/.backup, excluding the backup itself.
 * @param {string} specsDir - The specs directory path.
 * @returns {Promise<void>}
 */
async function backupSpecsDirectory(specsDir) {
    const backupDir = path.join(specsDir, '.backup');
    await fs.rm(backupDir, { recursive: true, force: true });
    await fs.mkdir(backupDir, { recursive: true });

    async function copyDir(sourceDir, targetDir, currentDir = '') {
        const entries = await fs.readdir(path.join(sourceDir, currentDir), { withFileTypes: true });
        for (const entry of entries) {
            const relativePath = path.join(currentDir, entry.name);
            const normalizedRelPath = relativePath.replace(/\\/g, '/');
            if (normalizedRelPath === '.backup' || normalizedRelPath.startsWith('.backup/')) {
                continue;
            }
            const sourcePath = path.join(sourceDir, relativePath);
            const targetPath = path.join(targetDir, relativePath);
            if (entry.isDirectory()) {
                await fs.mkdir(targetPath, { recursive: true });
                await copyDir(sourceDir, targetDir, relativePath);
            } else {
                await fs.mkdir(path.dirname(targetPath), { recursive: true });
                await fs.copyFile(sourcePath, targetPath);
            }
        }
    }

    await copyDir(specsDir, backupDir);
}

/**
 * Get the newest modification time among spec files.
 * @param {string} dir - Specs directory path.
 * @returns {Promise<number>} Newest mtime or 0 if none.
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
 * Get the oldest modification time among generated target files.
 * Missing targets cause regeneration (returns 0).
 * @param {string} baseDir - Skill directory where targets live.
 * @param {string[]} targetFiles - Relative target file paths.
 * @returns {Promise<number>} Oldest mtime or 0 if any target is missing.
 */
async function getOldestGeneratedFileTime(baseDir, targetFiles) {
    let oldestTime = Infinity;
    for (const relPath of targetFiles) {
        const absPath = path.join(baseDir, relPath);
        try {
            const stats = await fs.stat(absPath);
            if (stats.mtimeMs < oldestTime) {
                oldestTime = stats.mtimeMs;
            }
        } catch (error) {
            // Missing file -> force regeneration
            return 0;
        }
    }
    return targetFiles.length === 0 ? 0 : oldestTime;
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
 * Safely parse a JSON response from the LLM.
 * @param {any} response
 * @param {string} label
 * @returns {object}
 */
function parseJsonResponse(response, label) {
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
 * Convert spec relative path to target output path (without specs/ prefix and without .md/.mds).
 * @param {string} relativePath
 * @returns {string}
 */
function specPathToTarget(relativePath) {
    return relativePath
        .replace(/\\/g, '/')
        .replace(/^specs\//, '')
        .replace(/\.mds?$/, '');
}

/**
 * Normalize generated file paths to keep them within sourcePath and avoid redundant prefixes.
 * - Removes leading './'
 * - Removes leading `${sourceName}/`
 * - Converts backslashes to '/'
 * - Rejects paths that escape the sourcePath (contain '..' after normalize)
 * @param {string} relativePath
 * @param {string} sourceName
 * @returns {string|null} normalized path or null if invalid
 */
function normalizeGeneratedPath(relativePath, sourceName) {
    let cleaned = relativePath.replace(/\\/g, '/');
    if (cleaned.startsWith('./')) {
        cleaned = cleaned.slice(2);
    }
    if (cleaned.startsWith(`${sourceName}/`)) {
        cleaned = cleaned.slice(sourceName.length + 1);
    }
    // Prevent absolute paths
    if (cleaned.startsWith('/')) {
        cleaned = cleaned.slice(1);
    }
    const normalized = path.normalize(cleaned);
    if (normalized.startsWith('..')) {
        return null;
    }
    return normalized.replace(/\\/g, '/');
}

/**
 * Build a multi-file text block for LLM prompts.
 * @param {Map<string, string>} generatedFiles
 * @returns {string}
 */
function buildGeneratedFilesBlock(generatedFiles) {
    let output = '';
    for (const [filePath, code] of generatedFiles.entries()) {
        output += `\n\n## file-path: ${filePath}\n\n\`\`\`javascript\n${code}\n\`\`\``;
    }
    return output.trim();
}

/**
 * Ask LLM to generate behavioral tests for the action(promptText) API.
 * @param {string} specsForPrompt
 * @param {string} existingCodeForPrompt
 * @param {object} llmAgent
 * @returns {Promise<Array<{name: string, promptText: string, expectedOutput: any}>>}
 */
async function generateBehaviorTests(specsForPrompt, existingCodeForPrompt, llmAgent) {
    const prompt = `
# Behavior Test Generation

You are an expert test designer. Generate behavior tests for a skill's public API: action({ promptText }).
Each test must include:
- name (short string)
- promptText (string; may be natural language or structured, no restrictions)
- expectedOutput (exact JSON value the action should return; can be object, array, string, number, boolean, or null)

The tests MUST be based on the specifications and MUST be valid inputs that should not throw.
Do not generate edge cases.
Expected outputs must be computed exactly according to the spec.
The tests are NOT about file names or module structure; only runtime behavior.

## Specifications
${specsForPrompt}

## Existing Code Context
${existingCodeForPrompt || 'No existing code context provided.'}

## Output Requirements
Return STRICT JSON with the following shape and no extra keys:
{
  "tests": [
    {
      "name": "...",
      "promptText": "...",
      "expectedOutput": null
    }
  ]
}
Keep the test list small (4-8 tests).
`;

    const response = await llmAgent.executePrompt(prompt, {
        mode: 'deep',
        responseShape: 'json',
        context: { intent: 'generate-behavior-tests' },
    });

    const parsed = parseJsonResponse(response, 'Behavior test generation');
    if (!parsed || !Array.isArray(parsed.tests) || parsed.tests.length === 0) {
        throw new Error('Behavior test generation returned no tests.');
    }
    return parsed.tests;
}

/**
 * Validate generated code against behavior tests, optionally returning corrected code.
 * @param {Map<string, string>} generatedFiles
 * @param {Array<{name: string, promptText: string, expectedOutput: any}>} tests
 * @param {object} llmAgent
 * @returns {Promise<{status: 'pass'} | {status: 'fail', files: Array<{path: string, code: string}>}>}
 */
async function validateOrRepairGeneratedCode(generatedFiles, tests, llmAgent) {
    const filesBlock = buildGeneratedFilesBlock(generatedFiles);
    const prompt = `
# Behavior Validation / Repair

You are a senior engineer. Given the code and the behavior tests, decide if the code is correct.
The tests are authoritative and must match EXACT expectedOutput (including primitives).

If all tests pass, return:
{ "status": "pass" }

If any test would fail, return:
{
  "status": "fail",
  "files": [
    { "path": "relative/path.ext", "code": "..." }
  ]
}

Do NOT include explanations. Only strict JSON.

## Behavior Tests
${JSON.stringify({ tests }, null, 2)}

## Generated Code
${filesBlock}
`;

    const response = await llmAgent.executePrompt(prompt, {
        mode: 'deep',
        responseShape: 'json',
        context: { intent: 'validate-or-repair-generated-code' },
    });

    const parsed = parseJsonResponse(response, 'Behavior validation');
    if (!parsed || (parsed.status !== 'pass' && parsed.status !== 'fail')) {
        throw new Error('Behavior validation returned invalid status.');
    }
    if (parsed.status === 'fail') {
        if (!Array.isArray(parsed.files) || parsed.files.length === 0) {
            throw new Error('Behavior validation returned fail without files.');
        }
    }
    return parsed;
}

/**
 * Generate code from a specs directory into the source root.
 * @param {string} sourcePath - Directory containing specs/.
 * @param {object} llmAgent - LLM agent instance to use for generation.
 * @param {object} [logger=console] - Logger instance.
 * @returns {Promise<string[]>} Array of generated file paths (relative to sourcePath), or empty array if skipped/up-to-date.
 */
export async function generateMirrorCode(sourcePath, llmAgent, logger = console) {
    const debugLogger = getDebugLogger();
    const specsDir = path.join(sourcePath, 'specs');
    const backupSpecsDir = path.join(specsDir, '.backup');
    const sourceName = path.basename(sourcePath);

    try {
        const specsDirExists = await fs.stat(specsDir).then(stat => stat.isDirectory()).catch(() => false);
        if (!specsDirExists) {
            debugLogger?.log('generateMirrorCode:skip', { skill: sourceName, reason: 'No specs directory found.' });
            return [];
        }

        // Gather specs and compute targets
        const specFiles = await findSpecFiles(specsDir);
        if (specFiles.length === 0) {
            logger.warn(`[generateMirrorCode] No spec files found in ${specsDir} for "${sourceName}".`);
            return [];
        }

        const targetFiles = specFiles.map(file => specPathToTarget(file.relativePath));

        // Up-to-date check using target files in skill root
        const newestSpecTime = await getNewestSpecFileTime(specsDir);
        const oldestGeneratedTime = await getOldestGeneratedFileTime(sourcePath, targetFiles);
        const needsRegeneration = !(newestSpecTime > 0 && newestSpecTime <= oldestGeneratedTime);

        if (!needsRegeneration) {
            debugLogger?.log('generateMirrorCode:skip', { skill: sourceName, reason: 'Source code is up-to-date.' });
            return [];
        }

        debugLogger?.log('generateMirrorCode:start', { skill: sourceName, reason: 'Source is missing or outdated.' });

        // Build prompt from specs and existing code context
        let specsForPrompt = '';
        for (const specFile of specFiles) {
            const content = await fs.readFile(specFile.absolutePath, 'utf-8');
            const targetPath = specPathToTarget(specFile.relativePath);
            specsForPrompt += `\n\n---\n# Spec for: ${targetPath}\n\n${content}`;
        }

        let backupSpecsForPrompt = '';
        const backupSpecsExists = await fs.stat(backupSpecsDir).then(stat => stat.isDirectory()).catch(() => false);
        if (backupSpecsExists) {
            const backupSpecFiles = await findSpecFiles(backupSpecsDir);
            for (const specFile of backupSpecFiles) {
                const content = await fs.readFile(specFile.absolutePath, 'utf-8');
                const relativeFromBackup = path.relative(backupSpecsDir, specFile.absolutePath);
                const targetPath = specPathToTarget(relativeFromBackup);
                backupSpecsForPrompt += `\n\n---\n# Previous spec for: ${targetPath}\n\n${content}`;
            }
        }

        let existingCodeForPrompt = '';
        const existingCodeFiles = await findExistingCodeFiles(sourcePath);
        for (const file of existingCodeFiles) {
            const content = await fs.readFile(file.absolutePath, 'utf-8');
            const normalizedRelPath = file.relativePath.replace(/\\/g, '/');
            existingCodeForPrompt += `\n\n---\n# Existing code: ${normalizedRelPath}\n\n${content}`;
        }

        const prompt = `
# Multi-File Code Generation Request

You are an expert JavaScript programmer. Generate the full source code for multiple ECMAScript modules (ESM) based on the provided specifications.

## Module Specifications
${specsForPrompt}

## Previous Specifications (from specs/.backup)
${backupSpecsForPrompt || 'No previous specs were available.'}

## Existing Code Context
${existingCodeForPrompt || 'No existing code files were available.'}

## INSTRUCTIONS
- Use the exact relative file paths implied by the specs (no extra prefixes like the source directory name).
- Compare current specs with previous specs when available, and focus changes on the parts that differ.
- Preserve existing behavior and structure where specs are unchanged and the current code already works.
- Your response **MUST** be a series of markdown blocks, one for each file.
- For each file, you **MUST** use a header to specify the relative file path.
- Do not add any other text, explanations, or apologies.

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

        const response = await llmAgent.executePrompt(prompt, {
            mode: 'deep',
            responseShape: 'text',
            context: { intent: 'generate-multi-file-code-from-specs' },
        });

        const generatedFiles = parseMultiFileMarkdown(response);
        if (generatedFiles.size === 0) {
            throw new Error(`LLM did not return any parsable files. Response was: ${response.substring(0, 500)}...`);
        }

        logger.log(`[generateMirrorCode] Parsed ${generatedFiles.size} files from LLM response for "${sourceName}".`);

        const tests = await generateBehaviorTests(specsForPrompt, existingCodeForPrompt, llmAgent);
        debugLogger?.log('generateMirrorCode:testsGenerated', { source: sourceName, count: tests.length });

        const validation = await validateOrRepairGeneratedCode(generatedFiles, tests, llmAgent);
        debugLogger?.log('generateMirrorCode:testsValidated', { source: sourceName, status: validation.status });

        let finalGeneratedFiles = generatedFiles;
        if (validation.status === 'fail') {
            const repaired = new Map();
            for (const file of validation.files) {
                if (!file?.path || typeof file.code !== 'string') {
                    continue;
                }
                repaired.set(file.path, file.code);
            }
            if (repaired.size === 0) {
                throw new Error('Behavior validation did not return any valid files to write.');
            }
            finalGeneratedFiles = repaired;
            logger.warn(`[generateMirrorCode] Behavior validation failed; writing repaired code for "${sourceName}".`);
        }

        // Track generated file paths for return value
        const generatedFilePaths = [];

        // Write generated files directly into source root, respecting target paths
        for (const [rawRelativePath, code] of finalGeneratedFiles.entries()) {
            const normalizedRelPath = normalizeGeneratedPath(rawRelativePath, sourceName);
            if (!normalizedRelPath) {
                logger.warn(`[generateMirrorCode] Skipping invalid path "${rawRelativePath}" for "${sourceName}".`);
                continue;
            }
            const outputPath = path.join(sourcePath, normalizedRelPath);
            await fs.mkdir(path.dirname(outputPath), { recursive: true });
            await fs.writeFile(outputPath, code, 'utf-8');
            debugLogger?.log('generateMirrorCode:wroteFile', { source: sourceName, path: outputPath });
            generatedFilePaths.push(normalizedRelPath);
        }

        await backupSpecsDirectory(specsDir);
        debugLogger?.log('generateMirrorCode:backupSpecs', { source: sourceName, path: backupSpecsDir });

        logger.log(`[generateMirrorCode] Successfully generated all ${generatedFiles.size} files for "${sourceName}".`);

        return generatedFilePaths;

    } catch (error) {
        logger.error(`[generateMirrorCode] Failed to generate code for "${sourceName}": ${error.message}`);
        debugLogger?.log('generateMirrorCode:error', { source: sourceName, error: error.stack });
        throw error;
    }
}

export { generateBehaviorTests, validateOrRepairGeneratedCode };
