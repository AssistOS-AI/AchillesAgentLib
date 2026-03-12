import fs from 'node:fs/promises';
import path from 'node:path';

import { parseJsonInput } from './utils.mjs';

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
                    regex += '(?:.*\\/)?';
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

async function listFiles(targetPath) {
    let stat;
    try {
        stat = await fs.stat(targetPath);
    } catch {
        return [];
    }

    if (stat.isFile()) {
        return [targetPath];
    }

    if (!stat.isDirectory()) {
        return [];
    }

    const entries = await fs.readdir(targetPath, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
        const fullPath = path.join(targetPath, entry.name);
        if (entry.isDirectory()) {
            files.push(...await listFiles(fullPath));
        } else if (entry.isFile()) {
            files.push(fullPath);
        }
    }
    return files;
}

function buildRegex(pattern, { caseInsensitive, dotAll, global } = {}) {
    const flags = `${caseInsensitive ? 'i' : ''}${global ? 'g' : ''}${dotAll ? 's' : ''}`;
    return new RegExp(pattern, flags);
}

function collectContentMatches(text, lineOffset, lineRegex, contextBefore, contextAfter, includeNumbers) {
    const lines = text.split(/\r?\n/);
    const matchedLineIndexes = new Set();

    lines.forEach((line, index) => {
        if (lineRegex.test(line)) {
            const start = Math.max(0, index - contextBefore);
            const end = Math.min(lines.length - 1, index + contextAfter);
            for (let i = start; i <= end; i += 1) {
                matchedLineIndexes.add(i);
            }
        }
        if (lineRegex.global) {
            lineRegex.lastIndex = 0;
        }
    });

    const sorted = Array.from(matchedLineIndexes).sort((a, b) => a - b);
    return sorted.map((index) => {
        const lineNumber = lineOffset + index + 1;
        const prefix = includeNumbers ? `${lineNumber}:` : '';
        return `${prefix}${lines[index]}`;
    });
}

export function buildGrepTool() {
    return {
        description: `Search file contents using regex (ripgrep).
When to use: search for text or patterns across files.
How to call: pass JSON string with pattern and optional options (path, output_mode, glob, type, -i, -n, -A/-B/-C, multiline, head_limit). Paths can be absolute or relative to project root.
Examples:
- {"pattern":"TODO","path":"/abs/project","output_mode":"files_with_matches"}
- {"pattern":"TODO","path":"src","output_mode":"files_with_matches"}
- {"pattern":"function\\s+\\w+","glob":"*.js","output_mode":"content","-n":true}
Notes: default output_mode is files_with_matches; returns empty string if no matches.`,
        handler: async (_agent, promptText) => {
            const { json, raw } = parseJsonInput(promptText);
            const input = json && typeof json === 'object' ? json : { pattern: raw };
            const pattern = String(input.pattern || '').trim();
            if (!pattern) {
                throw new Error('Grep requires a pattern.');
            }

            const outputMode = input.output_mode || 'files_with_matches';
            const caseInsensitive = Boolean(input['-i']);
            const includeNumbers = outputMode === 'content' && Boolean(input['-n']);
            const contextAfter = outputMode === 'content'
                ? Number(input['-C'] ?? input['-A'] ?? 0)
                : 0;
            const contextBefore = outputMode === 'content'
                ? Number(input['-C'] ?? input['-B'] ?? 0)
                : 0;
            const dotAll = Boolean(input.multiline);
            const headLimit = input.head_limit && Number.isFinite(Number(input.head_limit))
                ? Math.max(0, Number(input.head_limit))
                : null;
            const targetPathRaw = String(input.path || process.cwd());
            const targetPath = path.isAbsolute(targetPathRaw)
                ? targetPathRaw
                : path.resolve(process.cwd(), targetPathRaw);

            let files = await listFiles(targetPath);
            if (input.glob) {
                const globRegex = globToRegex(String(input.glob));
                files = files.filter((filePath) => {
                    const normalized = filePath.split(path.sep).join('/');
                    return globRegex.test(normalized) || globRegex.test(path.basename(normalized));
                });
            }

            let lineRegex;
            let fullRegex;
            try {
                lineRegex = buildRegex(pattern, { caseInsensitive, dotAll: false, global: false });
                fullRegex = buildRegex(pattern, { caseInsensitive, dotAll, global: true });
            } catch (error) {
                throw new Error(`Grep failed: ${error.message}`);
            }

            const outputs = [];
            for (const filePath of files) {
                const buffer = await fs.readFile(filePath);
                const text = buffer.toString('utf8');

                if (outputMode === 'files_with_matches') {
                    const hasMatch = dotAll ? fullRegex.test(text) : lineRegex.test(text);
                    if (hasMatch) {
                        outputs.push(filePath);
                    }
                    fullRegex.lastIndex = 0;
                    continue;
                }

                if (outputMode === 'count') {
                    let count = 0;
                    if (dotAll) {
                        const matches = text.match(fullRegex);
                        count = matches ? matches.length : 0;
                    } else {
                        const lines = text.split(/\r?\n/);
                        for (const line of lines) {
                            const matches = line.match(fullRegex);
                            if (matches) {
                                count += matches.length;
                            }
                        }
                    }
                    if (count > 0) {
                        outputs.push(`${filePath}:${count}`);
                    }
                    fullRegex.lastIndex = 0;
                    continue;
                }

                if (outputMode === 'content') {
                    const matches = collectContentMatches(
                        text,
                        0,
                        lineRegex,
                        Number.isFinite(contextBefore) ? contextBefore : 0,
                        Number.isFinite(contextAfter) ? contextAfter : 0,
                        includeNumbers
                    );
                    if (matches.length) {
                        outputs.push(...matches.map((line) => `${filePath}:${line}`));
                    }
                }
            }

            let output = outputs.join('\n');
            if (headLimit !== null) {
                output = output.split('\n').slice(0, headLimit).join('\n');
            }
            return output.trim();
        },
    };
}
