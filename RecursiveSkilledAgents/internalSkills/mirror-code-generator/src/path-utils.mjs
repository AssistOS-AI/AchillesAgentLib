import fs from 'node:fs/promises';

async function dirExists(dirPath) {
    return fs.stat(dirPath).then(stat => stat.isDirectory()).catch(() => false);
}

async function fileExists(filePath) {
    return fs.stat(filePath).then(stat => stat.isFile()).catch(() => false);
}

function normalizePath(value) {
    return String(value || '').replace(/\\/g, '/').trim();
}

function normalizeRelativePath(value) {
    const normalized = normalizePath(value);
    return normalized.replace(/^\.\//, '');
}

function normalizeKeyPath(value) {
    return normalizeRelativePath(value).replace(/^\.\//, '');
}

export {
    dirExists,
    fileExists,
    normalizePath,
    normalizeRelativePath,
    normalizeKeyPath,
};
