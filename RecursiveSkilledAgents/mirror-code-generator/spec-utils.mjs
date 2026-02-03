import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Recursively finds all spec files (.md/.mds) in a directory.
 * @param {string} baseDir - The base directory to start searching from.
 * @param {string} [currentDir=''] - The current subdirectory, used for recursion.
 * @returns {Promise<Array<{relativePath: string, absolutePath: string}>>} A list of spec files with their paths.
 */
export async function findSpecFiles(baseDir, currentDir = '') {
    const entries = await fs.readdir(path.join(baseDir, currentDir), { withFileTypes: true });
    let files = [];
    for (const entry of entries) {
        const relativePath = path.join(currentDir, entry.name);
        const normalizedRelPath = relativePath.replace(/\\/g, '/');
        if (normalizedRelPath === '.backup' || normalizedRelPath.startsWith('.backup/')) {
            continue;
        }
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
export async function findExistingCodeFiles(baseDir, currentDir = '') {
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
export async function backupSpecsDirectory(specsDir) {
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
 * Extracts the Testing/Validation section from a spec file.
 * Matches #Validation, ##Validation, #Testing, ##Testing headings.
 * @param {string} content
 * @returns {string|null}
 */
export function extractTestingSection(content) {
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i].trim();
        const match = line.match(/^(#{1,2})\s*(Validation|Testing)\s*$/i);
        if (!match) {
            continue;
        }
        const level = match[1].length;
        const sectionLines = [];
        for (let j = i + 1; j < lines.length; j += 1) {
            const nextLine = lines[j];
            const headingMatch = nextLine.trim().match(/^(#{1,6})\s+.+/);
            if (headingMatch && headingMatch[1].length <= level) {
                break;
            }
            sectionLines.push(nextLine);
        }
        const sectionText = sectionLines.join('\n').trim();
        return sectionText.length > 0 ? sectionText : null;
    }
    return null;
}

/**
 * Convert spec relative path to target output path (without specs/ prefix and without .md/.mds).
 * @param {string} relativePath
 * @returns {string}
 */
export function specPathToTarget(relativePath) {
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
export function normalizeGeneratedPath(relativePath, sourceName) {
    let cleaned = relativePath.replace(/\\/g, '/');
    if (cleaned.startsWith('./')) {
        cleaned = cleaned.slice(2);
    }
    if (cleaned.startsWith(`${sourceName}/`)) {
        cleaned = cleaned.slice(sourceName.length + 1);
    }
    if (cleaned.startsWith('/')) {
        cleaned = cleaned.slice(1);
    }
    const normalized = path.normalize(cleaned);
    if (normalized.startsWith('..')) {
        return null;
    }
    return normalized.replace(/\\/g, '/');
}
