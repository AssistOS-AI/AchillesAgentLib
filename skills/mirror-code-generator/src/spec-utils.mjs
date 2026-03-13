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
 * Convert spec relative path to target output path (without specs/ prefix and without .md/.mds).
 * @param {string} relativePath
 * @returns {string}
 */
export function specPathToTarget(relativePath) {
    const cleaned = relativePath
        .replace(/\\/g, '/')
        .replace(/^specs\//, '')
        .replace(/\.mds?$/, '');
    const trimmed = cleaned.replace(/^src\//, '');
    return `src/${trimmed}`.replace(/\/+/, '/');
}
