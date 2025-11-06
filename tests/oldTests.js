#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join, extname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const COLOR_RESET = '\x1b[0m';
const COLOR_TEST = '\x1b[37m';
const COLOR_DETAIL = '\x1b[90m';
const COLOR_STDERR = '\x1b[91m';
const COLOR_PASS = '\x1b[32m';
const COLOR_FAIL = '\x1b[31m';

const testsRoot = fileURLToPath(new URL('.', import.meta.url));
const useSkillRoot = join(testsRoot, 'useSkill');

const DEFAULT_DISABLED = new Set(['helpers.mjs', 'runAllTests.mjs']);
const envDisabled = (process.env.DISABLED_TESTS || '')
    .split(',')
    .map(entry => entry.trim())
    .filter(Boolean);
const disabled = new Set([...DEFAULT_DISABLED, ...envDisabled]);

function collectUseSkillTests() {
    let entries;
    try {
        entries = readdirSync(useSkillRoot, { withFileTypes: true });
    } catch (error) {
        console.error(`${COLOR_FAIL}Failed to read tests/useSkill directory: ${error.message}${COLOR_RESET}`);
        process.exit(1);
    }

    return entries
        .filter(entry => entry.isFile() && extname(entry.name) === '.mjs')
        .map(entry => entry.name)
        .filter(fileName => fileName.endsWith('.test.mjs'))
        .filter(fileName => !disabled.has(fileName) && !disabled.has(join('useSkill', fileName)))
        .sort();
}

async function streamLines(stream, onLine) {
    return new Promise((resolve) => {
        let buffer = '';
        stream.setEncoding('utf8');
        stream.on('data', (chunk) => {
            buffer += chunk;
            let newlineIndex;
            while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
                const line = buffer.slice(0, newlineIndex);
                buffer = buffer.slice(newlineIndex + 1);
                onLine(line);
            }
        });
        stream.on('end', () => {
            if (buffer.length) {
                onLine(buffer);
            }
            resolve();
        });
    });
}

const testFiles = collectUseSkillTests();

if (!testFiles.length) {
    console.log('No useSkill test files found.');
    process.exit(0);
}

if (envDisabled.length) {
    console.log(`Disabled tests: ${envDisabled.join(', ')}`);
}

const results = [];

async function runTest(fileName) {
    const absolutePath = join(useSkillRoot, fileName);
    const relativePath = relative(testsRoot, absolutePath);
    console.log(`${COLOR_TEST}${relativePath}${COLOR_RESET}`);

    const child = spawn('node', ['--test', absolutePath], {
        stdio: ['ignore', 'pipe', 'pipe'],
        cwd: testsRoot,
    });

    let exitCode = 0;
    const stdoutLines = [];
    const stderrLines = [];

    await Promise.all([
        streamLines(child.stdout, (line) => {
            stdoutLines.push(line);
            console.log(`${COLOR_DETAIL}${line}${COLOR_RESET}`);
        }),
        streamLines(child.stderr, (line) => {
            stderrLines.push(line);
            const colour = line.trim() ? COLOR_STDERR : COLOR_DETAIL;
            console.log(`${colour}${line}${COLOR_RESET}`);
        }),
        new Promise((resolve) => child.on('exit', (code) => {
            exitCode = typeof code === 'number' ? code : 0;
            resolve();
        })),
    ]);

    const passed = exitCode === 0;
    results.push({
        file: relativePath,
        status: passed ? 'passed' : 'failed',
        exitCode,
        stdout: stdoutLines.join('\n'),
        stderr: stderrLines.join('\n'),
    });

    const statusLabel = passed
        ? `${COLOR_PASS}PASS${COLOR_RESET}`
        : `${COLOR_FAIL}FAIL${COLOR_RESET}`;
    console.log(`${statusLabel} ${COLOR_TEST}${relativePath}${COLOR_RESET}`);
}

for (const fileName of testFiles) {
    await runTest(fileName);
}

const failed = results.filter(result => result.status === 'failed');

console.log('\nUseSkill Test Summary');
console.log('---------------------');
console.log(`${COLOR_TEST}Total:${COLOR_RESET} ${results.length} | ${COLOR_TEST}Passed:${COLOR_RESET} ${results.length - failed.length} | ${COLOR_TEST}Failed:${COLOR_RESET} ${failed.length}`);

if (!failed.length) {
    console.log(`${COLOR_PASS}Status: all useSkill tests passed.${COLOR_RESET}`);
    process.exit(0);
}

const collectLines = (text) => {
    if (!text) {
        return [];
    }
    const raw = text.split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
    const filtered = raw.filter((line) => !line.startsWith('[AchillesAgentsLib]'));
    return filtered.length ? filtered : raw;
};

console.log(`${COLOR_FAIL}Status: failures detected.${COLOR_RESET}`);
console.log(`${COLOR_FAIL}Failures:${COLOR_RESET}`);
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

process.exit(1);
