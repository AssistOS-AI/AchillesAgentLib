import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

function isDirectory(target) {
    if (!target || !fs.existsSync(target)) {
        return false;
    }
    try {
        return fs.statSync(target).isDirectory();
    } catch {
        return false;
    }
}

function isSafeChildPath(baseDir, targetPath) {
    if (!baseDir || !targetPath) {
        return false;
    }
    const resolvedBase = path.resolve(baseDir);
    const resolvedTarget = path.resolve(targetPath);
    if (resolvedTarget === resolvedBase) {
        return true;
    }
    return resolvedTarget.startsWith(`${resolvedBase}${path.sep}`);
}

function isProbablyText(buffer) {
    if (!buffer || !buffer.length) {
        return true;
    }
    let controlCount = 0;
    for (const byte of buffer) {
        if (byte === 0) {
            return false;
        }
        if (byte < 9 || (byte > 13 && byte < 32)) {
            controlCount += 1;
        }
    }
    const ratio = controlCount / buffer.length;
    if (ratio > 0.2) {
        return false;
    }
    const decoded = buffer.toString('utf8');
    return !decoded.includes('\uFFFD');
}

function runBashCommand(command, cwd, timeout) {
    return new Promise((resolve, reject) => {
        const child = spawn('bash', ['-lc', command], { cwd, env: process.env });
        let stdout = '';
        let stderr = '';
        let finished = false;
        let timeoutId = null;

        if (timeout && Number.isFinite(timeout)) {
            timeoutId = setTimeout(() => {
                if (finished) {
                    return;
                }
                finished = true;
                child.kill('SIGKILL');
                resolve({ stdout, stderr, exitCode: 124, timedOut: true });
            }, timeout);
        }

        child.stdout.on('data', (data) => {
            stdout += data.toString();
        });
        child.stderr.on('data', (data) => {
            stderr += data.toString();
        });
        child.on('error', (error) => {
            if (timeoutId) {
                clearTimeout(timeoutId);
            }
            if (finished) {
                return;
            }
            finished = true;
            reject(error);
        });
        child.on('close', (code) => {
            if (timeoutId) {
                clearTimeout(timeoutId);
            }
            if (finished) {
                return;
            }
            finished = true;
            resolve({ stdout, stderr, exitCode: code ?? 0, timedOut: false });
        });
    });
}

function parseKeyValueInput(promptText) {
    const text = String(promptText ?? '').trim();
    if (!text) {
        return { data: {}, raw: '', hasPairs: false };
    }
    const segments = text
        .split(/\r?\n/)
        .flatMap((line) => line.split(/,(?=\s*[^,]+:)/))
        .map((part) => part.trim())
        .filter(Boolean);

    const data = {};
    let hasPairs = false;

    for (const segment of segments) {
        const match = segment.match(/^([A-Za-z0-9_.-]+)\s*:\s*(.+)$/);
        if (!match) {
            continue;
        }
        hasPairs = true;
        const key = match[1];
        let value = match[2].trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        if (/^(true|false)$/i.test(value)) {
            data[key] = value.toLowerCase() === 'true';
            continue;
        }
        if (/^-?\d+(\.\d+)?$/.test(value)) {
            data[key] = Number(value);
            continue;
        }
        data[key] = value;
    }

    return { data, raw: text, hasPairs };
}

function resolvePath(targetPath, label = 'path') {
    const normalized = String(targetPath || '').trim();
    if (!normalized) {
        throw new Error(`${label} is required.`);
    }
    if (path.isAbsolute(normalized)) {
        return normalized;
    }
    return path.resolve(process.cwd(), normalized);
}

function normalizePathSeparators(targetPath) {
    return String(targetPath || '').split(path.sep).join('/');
}

export {
    isDirectory,
    isProbablyText,
    isSafeChildPath,
    normalizePathSeparators,
    parseKeyValueInput,
    resolvePath,
    runBashCommand,
};
