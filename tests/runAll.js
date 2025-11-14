#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join, extname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootPath = fileURLToPath(new URL('.', import.meta.url));
const EXCLUDED_DIRECTORIES = new Set([
    'dbtableSkills',
    'useSkill',
]);

const DEFAULT_DISABLED = new Set([
    'runAll.js',
    'oldTests.js',
    'useSkill/helpers.mjs',
    'useSkill/runAllTests.mjs',
]);
const envDisabled = (process.env.DISABLED_TESTS || '')
    .split(',')
    .map(entry => entry.trim())
    .filter(Boolean);
const disabled = new Set([...DEFAULT_DISABLED, ...envDisabled]);

const shouldExclude = (relativePath) => {
    for (const dir of EXCLUDED_DIRECTORIES) {
        if (relativePath === dir || relativePath.startsWith(`${dir}/`)) {
            return true;
        }
    }
    return false;
};

function collectTestFiles(dirPath, basePath = dirPath) {
    const collected = [];
    const entries = readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
        if (entry.name.startsWith('.')) {
            continue;
        }

        const fullPath = join(dirPath, entry.name);
        const relativePath = relative(basePath, fullPath);
        if (entry.isDirectory()) {
            if (shouldExclude(relativePath)) {
                continue;
            }
            collected.push(...collectTestFiles(fullPath, basePath));
            continue;
        }
        if (extname(entry.name) !== '.mjs') {
            continue;
        }

        if (shouldExclude(relativePath)) {
            continue;
        }
        if (disabled.has(entry.name) || disabled.has(relativePath)) {
            continue;
        }
        collected.push(relativePath);
    }

    return collected;
}

let testFiles = collectTestFiles(rootPath).sort();
const codeSkillsTest = 'codeSkills/codeSkills.test.mjs';
const mathEvalDirectTest = 'codeSkills/mathEvalDirect.test.mjs';

const pushToEnd = (files, target) => {
    const position = files.indexOf(target);
    if (position === -1) {
        return files;
    }
    const reordered = files.slice(0, position).concat(files.slice(position + 1));
    reordered.push(target);
    return reordered;
};

testFiles = pushToEnd(testFiles, codeSkillsTest);
testFiles = pushToEnd(testFiles, mathEvalDirectTest);

const COLOR_RESET = '\x1b[0m';
const COLOR_TEST = '\x1b[37m';
const COLOR_DETAIL = '\x1b[90m';
const COLOR_STDERR = '\x1b[91m';
const COLOR_PASS = '\x1b[32m';
const COLOR_FAIL = '\x1b[31m';

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

if (!testFiles.length) {
    console.log('No test files found.');
    process.exit(0);
}

if (disabled.size) {
    console.log('Disabled tests:', Array.from(disabled).join(', ') || 'none');
}

const results = [];

async function runTest(relativePath) {
    const absolutePath = join(rootPath, relativePath);
    console.log(`${COLOR_TEST}${relativePath}${COLOR_RESET}`);

    const cwd = relativePath.startsWith('codeSkills/')
        ? join(rootPath, 'codeSkills')
        : rootPath;

    const child = spawn('node', ['--test', absolutePath], {
        stdio: ['ignore', 'pipe', 'pipe'],
        cwd,
    });
    let exitCode = 0;

    const stdoutLines = [];
    const stderrLines = [];

    await Promise.all([
        streamLines(child.stdout, (line) => {
            stdoutLines.push(line);
            const detailColour = COLOR_DETAIL;
            console.log(`${detailColour}${line}${COLOR_RESET}`);
        }),
        streamLines(child.stderr, (line) => {
            stderrLines.push(line);
            const detailColour = line.trim() ? COLOR_STDERR : COLOR_DETAIL;
            console.log(`${detailColour}${line}${COLOR_RESET}`);
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

for (const relativePath of testFiles) {
    await runTest(relativePath);
}

const failed = results.filter(result => result.status === 'failed');

console.log('\nTest Summary');
console.log('------------');
console.log(`${COLOR_TEST}Total:${COLOR_RESET} ${results.length} | ${COLOR_TEST}Passed:${COLOR_RESET} ${results.length - failed.length} | ${COLOR_TEST}Failed:${COLOR_RESET} ${failed.length}`);

if (!failed.length) {
    console.log(`${COLOR_PASS}Status: all tests passed.${COLOR_RESET}`);
} else {
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
}

if (failed.length) {
    process.exit(1);
}
