import fs from 'node:fs';

/**
 * Check if a path points to a readable file.
 * @param {string} candidate - Path to check
 * @returns {boolean} True if path is a readable file
 */
export function isReadableFile(candidate) {
    try {
        const stats = fs.statSync(candidate);
        return stats.isFile();
    } catch {
        return false;
    }
}

/**
 * Check if a path points to a directory.
 * @param {string} candidate - Path to check
 * @returns {boolean} True if path is a directory
 */
export function isDirectory(candidate) {
    try {
        const stats = fs.statSync(candidate);
        return stats.isDirectory();
    } catch {
        return false;
    }
}
