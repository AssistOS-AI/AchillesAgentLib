#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join, extname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootPath = fileURLToPath(new URL('.', import.meta.url));

const DEFAULT_DISABLED = new Set(['runAllTests.js', 'useSkill/helpers.mjs']);
const envDisabled = (process.env.DISABLED_TESTS || '')
    .split(',')
    .map(entry => entry.trim())
    .filter(Boolean);
const disabled = new Set([...DEFAULT_DISABLED, ...envDisabled]);

function collectTestFiles(dirPath, basePath = dirPath) {
    const collected = [];
    const entries = readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
        if (entry.name.startsWith('.')) {
            continue;
        }

        const fullPath = join(dirPath, entry.name);
        if (entry.isDirectory()) {
            collected.push(...collectTestFiles(fullPath, basePath));
            continue;
        }
        if (extname(entry.name) !== '.mjs') {
            continue;
        }

        const relativePath = relative(basePath, fullPath);
        if (disabled.has(entry.name) || disabled.has(relativePath)) {
            continue;
        }
        collected.push(relativePath);
    }

    return collected;
}

let testFiles = collectTestFiles(rootPath).sort();
const codeSkillsTest = 'codeSkills/codeSkills.test.mjs';
const idx = testFiles.indexOf(codeSkillsTest);
if (idx !== -1) {
    testFiles = testFiles.slice(0, idx).concat(testFiles.slice(idx + 1)).concat([codeSkillsTest]);
}

if (!testFiles.length) {
    console.log('No test files found.');
    process.exit(0);
}

if (disabled.size) {
    console.log('Disabled tests:', Array.from(disabled).join(', ') || 'none');
}

const results = [];

for (const relativePath of testFiles) {
    const absolutePath = join(rootPath, relativePath);
    console.log(`RUN ${relativePath}`);
    const child = spawnSync('node', ['--test', absolutePath], { stdio: 'pipe', encoding: 'utf8' });

    const passed = child.status === 0;
    results.push({
        file: relativePath,
        status: passed ? 'passed' : 'failed',
        exitCode: child.status,
        stdout: child.stdout?.trim() || '',
        stderr: child.stderr?.trim() || '',
    });

    const statusLabel = passed ? 'PASS' : 'FAIL';
    console.log(`${statusLabel} ${relativePath}`);
    if (child.stderr) {
        const stderrText = child.stderr.trim();
        if (stderrText) {
            console.log(`[stderr] ${relativePath}:`);
            console.log(stderrText.split('\n').map((line) => `  ${line}`).join('\n'));
        }
    }
    if (child.stdout) {
        const stdoutText = child.stdout.trim();
        if (stdoutText) {
            console.log(`[stdout] ${relativePath}:`);
            console.log(stdoutText.split('\n').map((line) => `  ${line}`).join('\n'));
        }
    }
}

const failed = results.filter(result => result.status === 'failed');

console.log('\nTest Summary');
console.log('------------');
console.log(`Total: ${results.length} | Passed: ${results.length - failed.length} | Failed: ${failed.length}`);

if (!failed.length) {
    console.log('Status: all tests passed.');
} else {
    const collectLines = (text) => {
        if (!text) {
            return [];
        }
        const raw = text.split('\n')
            .map((line) => line.trim())
            .filter(Boolean);
        const filtered = raw.filter((line) => !line.startsWith('[ploinkyAgentLib]'));
        return filtered.length ? filtered : raw;
    };

    console.log('Status: failures detected.');
    console.log('Failures:');
    failed.forEach((result) => {
        const stderrLines = collectLines(result.stderr);
        const stdoutLines = collectLines(result.stdout);
        const lines = stderrLines.length ? stderrLines : stdoutLines;
        const snippet = lines.slice(0, 4);
        const detail = snippet.length
            ? snippet.join(' | ')
            : `test failed (exit code ${result.exitCode})`;
        console.log(` - ${result.file}: ${detail}`);
    });
}

if (failed.length) {
    process.exit(1);
}
