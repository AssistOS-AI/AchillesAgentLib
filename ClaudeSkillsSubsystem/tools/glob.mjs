import fs from 'node:fs';
import path from 'node:path';

import { normalizePathSeparators, parseKeyValueInput } from './utils.mjs';

function escapeRegex(text) {
    return text.replace(/[.+^$|(){}\\]/g, '\\$&');
}

function globToRegex(pattern) {
    let regex = '^';
    let i = 0;
    while (i < pattern.length) {
        const char = pattern[i];
        if (char === '*') {
            if (pattern[i + 1] === '*') {
                i += 2;
                if (pattern[i] === '/') {
                    regex += '(?:.*\/)?';
                    i += 1;
                } else {
                    regex += '.*';
                }
            } else {
                regex += '[^/]*';
                i += 1;
            }
            continue;
        }
        if (char === '?') {
            regex += '[^/]';
            i += 1;
            continue;
        }
        if (char === '{') {
            const end = pattern.indexOf('}', i + 1);
            if (end === -1) {
                regex += '\\{';
                i += 1;
                continue;
            }
            const body = pattern.slice(i + 1, end);
            const parts = body.split(',').map((part) => escapeRegex(part));
            regex += `(?:${parts.join('|')})`;
            i = end + 1;
            continue;
        }
        if (char === '[') {
            const end = pattern.indexOf(']', i + 1);
            if (end === -1) {
                regex += '\\[';
                i += 1;
                continue;
            }
            const body = pattern.slice(i + 1, end);
            const negated = body.startsWith('!');
            const classBody = negated ? body.slice(1) : body;
            const safeBody = classBody.replace(/\\/g, '\\\\');
            regex += `[${negated ? '^' : ''}${safeBody}]`;
            i = end + 1;
            continue;
        }
        if ('./'.includes(char)) {
            regex += char === '.' ? '\\.' : '/';
            i += 1;
            continue;
        }
        regex += escapeRegex(char);
        i += 1;
    }
    regex += '$';
    return new RegExp(regex);
}

async function listFiles(rootDir, relativeBase = '') {
    let entries;
    try {
        entries = await fs.promises.readdir(rootDir, { withFileTypes: true });
    } catch {
        return [];
    }

    const files = [];
    for (const entry of entries) {
        const entryPath = path.join(rootDir, entry.name);
        const relativePath = relativeBase ? path.join(relativeBase, entry.name) : entry.name;
        if (entry.isDirectory()) {
            files.push(...await listFiles(entryPath, relativePath));
        } else if (entry.isFile()) {
            files.push(relativePath);
        }
    }
    return files;
}

export function buildGlobTool() {
    return {
        description: `Find files by glob pattern.
When to use: list or find files matching a pattern.
How to call: pass key:value pairs (newline or comma-separated). Required: pattern.
Examples:
- pattern: **/*.js
- pattern: **/*.js\n  path: src
- pattern: src/**/*.{ts,tsx}\n  path: /abs/project
Notes: returns a JSON array of absolute file paths sorted by mtime desc.`,
        handler: async (_agent, promptText) => {
            const { data, raw, hasPairs } = parseKeyValueInput(promptText);
            const input = hasPairs ? data : { pattern: raw };
            const pattern = String(input.pattern || '').trim();
            if (!pattern) {
                throw new Error('Glob requires a pattern.');
            }
            const baseDirRaw = input.path ? String(input.path) : process.cwd();
            const baseDir = path.isAbsolute(baseDirRaw)
                ? baseDirRaw
                : path.resolve(process.cwd(), baseDirRaw);
            const regex = globToRegex(normalizePathSeparators(pattern));
            const allFiles = await listFiles(baseDir);

            const matches = [];
            for (const file of allFiles) {
                const normalized = normalizePathSeparators(file);
                if (!regex.test(normalized)) {
                    continue;
                }
                const fullPath = path.resolve(baseDir, file);
                let stat;
                try {
                    stat = await fs.promises.stat(fullPath);
                } catch {
                    continue;
                }
                matches.push({ path: fullPath, mtimeMs: stat.mtimeMs });
            }

            matches.sort((a, b) => b.mtimeMs - a.mtimeMs);
            return JSON.stringify(matches.map((match) => match.path));
        },
    };
}
