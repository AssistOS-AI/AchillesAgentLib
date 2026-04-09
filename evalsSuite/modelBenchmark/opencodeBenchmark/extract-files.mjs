#!/usr/bin/env node
/**
 * Extracts files from opencode run logs.
 * Handles multiple output formats:
 *   1. Escaped JSON tool calls: code='{"filePath":"...","content":"..."}'
 *   2. Raw JSON tool calls: {"filePath":"...","content":"..."}
 *   3. Markdown blocks: [filepath]\n```js\ncode\n```
 *
 * Usage: node extract-files.mjs <logfile> <output-dir> [safe-name]
 */
import fs from 'node:fs';
import path from 'node:path';

const logFile = process.argv[2];
const outputDir = process.argv[3] || '.';
const safeName = process.argv[4] || '';

if (!logFile) {
    console.error('Usage: node extract-files.mjs <logfile> <output-dir> [safe-name]');
    process.exit(1);
}

const text = fs.readFileSync(logFile, 'utf8');
let count = 0;
const written = new Set();

function writeFile(fp, content) {
    let rel = fp;
    // Strip absolute path prefix to get relative path
    if (safeName && rel.includes(safeName + '/')) {
        rel = rel.split(safeName + '/').pop();
    } else if (path.isAbsolute(rel)) {
        // Try to find src/ or tests/ in the path
        const srcIdx = rel.indexOf('/src/');
        const testsIdx = rel.indexOf('/tests/');
        if (srcIdx >= 0) rel = rel.slice(srcIdx + 1);
        else if (testsIdx >= 0) rel = rel.slice(testsIdx + 1);
        else rel = path.basename(rel);
    }
    if (!rel.match(/\.(mjs|js)$/)) return;
    if (written.has(rel)) return;

    const outPath = path.join(outputDir, rel);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, content);
    written.add(rel);
    count++;
    console.log(`  ${rel} (${content.length} bytes)`);
}

// Strategy 1: Escaped JSON — {\"filePath\":\"...\",\"content\":\"...\"}
// These appear in opencode logs as code='...' with escaped quotes
const escapedJsonRe = /\{\\?"(?:filePath|file_path)\\?":\\?"([^\\]+?)\\?"[,:]\\?"content\\?":\\?"((?:[^\\]|\\[^"]|\\")*)\\?"\}/g;

// Better approach: find all occurrences of filePath in the text and extract JSON blocks
let idx = 0;
while (true) {
    const fpIdx = text.indexOf('filePath', idx);
    if (fpIdx < 0) break;

    // Find the opening { before filePath
    let braceIdx = fpIdx;
    while (braceIdx > 0 && text[braceIdx] !== '{') braceIdx--;

    if (text[braceIdx] === '{') {
        // Extract everything from { to the matching }
        // Handle escaped JSON (\" instead of ")
        const isEscaped = text[braceIdx + 1] === '\\';

        if (isEscaped) {
            // Escaped format: {\"filePath\":\"...\",\"content\":\"...\"}
            // Find the end by looking for }' or }" or just }
            let endIdx = braceIdx + 1;
            let depth = 1;
            while (endIdx < text.length && depth > 0) {
                if (text[endIdx] === '\\' && text[endIdx + 1] === '"') {
                    endIdx += 2; // skip escaped quote
                    continue;
                }
                if (text[endIdx] === '\\' && text[endIdx + 1] === '\\') {
                    endIdx += 2; // skip escaped backslash
                    continue;
                }
                if (text[endIdx] === '{') depth++;
                if (text[endIdx] === '}') depth--;
                endIdx++;
            }

            let jsonStr = text.slice(braceIdx, endIdx);
            // Unescape one level: \" -> "
            jsonStr = jsonStr.replace(/\\"/g, '"');
            // Now handle \\\\ -> \\ (double-escaped backslashes)
            // But be careful not to break \\n, \\t etc.

            try {
                const obj = JSON.parse(jsonStr);
                const fp = obj.filePath || obj.file_path;
                if (fp && obj.content) {
                    writeFile(fp, obj.content);
                }
            } catch (e) {
                // Try a more aggressive unescape
                try {
                    jsonStr = text.slice(braceIdx, endIdx)
                        .replace(/\\"/g, '"')
                        .replace(/\\\\/g, '\\');
                    const obj = JSON.parse(jsonStr);
                    const fp = obj.filePath || obj.file_path;
                    if (fp && obj.content) {
                        writeFile(fp, obj.content);
                    }
                } catch (e2) {
                    // Skip this block
                }
            }
        } else {
            // Raw JSON format: {"filePath":"...","content":"..."}
            let endIdx = braceIdx + 1;
            let depth = 1;
            let inString = false;
            let escaped = false;
            while (endIdx < text.length && depth > 0) {
                const ch = text[endIdx];
                if (escaped) { escaped = false; endIdx++; continue; }
                if (ch === '\\') { escaped = true; endIdx++; continue; }
                if (ch === '"') { inString = !inString; endIdx++; continue; }
                if (!inString) {
                    if (ch === '{') depth++;
                    if (ch === '}') depth--;
                }
                endIdx++;
            }

            const jsonStr = text.slice(braceIdx, endIdx);
            try {
                const obj = JSON.parse(jsonStr);
                const fp = obj.filePath || obj.file_path;
                if (fp && obj.content) {
                    writeFile(fp, obj.content);
                }
            } catch (e) {
                // Skip
            }
        }
    }

    idx = fpIdx + 8; // move past "filePath"
}

// Strategy 2: XML tool calls — <write_to_file><path>...</path><content>...</content></write_to_file>
// Uses manual parsing because content may contain </content>-like strings
if (count === 0) {
    const clean = text.replace(/\x1b\[[0-9;]*m/g, '');
    let xmlIdx = 0;
    while (true) {
        const start = clean.indexOf('<write_to_file>', xmlIdx);
        if (start < 0) break;
        const pathStart = clean.indexOf('<path>', start);
        const pathEnd = clean.indexOf('</path>', pathStart);
        const contentStart = clean.indexOf('<content>', pathEnd);
        const contentEnd = clean.indexOf('\n</content>', contentStart);
        const blockEnd = clean.indexOf('</write_to_file>', contentEnd > 0 ? contentEnd : contentStart);

        if (pathStart > 0 && pathEnd > 0 && contentStart > 0 && contentEnd > 0) {
            const fp = clean.slice(pathStart + 6, pathEnd).trim();
            const content = clean.slice(contentStart + 9, contentEnd);
            writeFile(fp, content);
        }
        xmlIdx = blockEnd > 0 ? blockEnd + 16 : start + 15;
    }
}

// Strategy 3: Markdown blocks (fallback)
if (count === 0) {
    const clean = text.replace(/\x1b\[[0-9;]*m/g, '');

    // [filepath]\n```js\ncode\n```
    const mdRe = /\[([^\]]*\.(?:mjs|js))\]\s*\n```(?:js|javascript|mjs)?\n([\s\S]*?)\n```/g;
    let m;
    while ((m = mdRe.exec(clean)) !== null) {
        writeFile(m[1].trim(), m[2]);
    }

    // ### filepath\n```js\ncode\n```
    const hdRe = /(?:^|\n)#{1,3}\s+[`]?([^\n`]*\.(?:mjs|js))[`]?\s*\n+```(?:js|javascript|mjs)?\n([\s\S]*?)\n```/g;
    while ((m = hdRe.exec(clean)) !== null) {
        writeFile(m[1].trim(), m[2]);
    }
}

console.log(`Total extracted: ${count} files`);
process.exit(count > 0 ? 0 : 1);
