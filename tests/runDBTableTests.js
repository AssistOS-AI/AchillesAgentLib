#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const COLOR_RESET = '\x1b[0m';
const COLOR_INFO = '\x1b[36m';
const COLOR_WARN = '\x1b[33m';
const COLOR_PASS = '\x1b[32m';
const COLOR_FAIL = '\x1b[31m';

const testsRoot = fileURLToPath(new URL('.', import.meta.url));
const dbTableRoot = join(testsRoot, 'dbtableSkills');
const EXCLUDED_DIRS = new Set(['fixtures', 'helpers']);
const TEST_TIMEOUT_MS = Number(process.env.DB_TABLE_TEST_TIMEOUT_MS || 60000);

function collectDbTableTests(baseDir = dbTableRoot) {
    const entries = readdirSync(baseDir, { withFileTypes: true });
    const files = [];

    for (const entry of entries) {
        const entryPath = join(baseDir, entry.name);
        if (entry.isDirectory()) {
            if (EXCLUDED_DIRS.has(entry.name)) {
                continue;
            }
            files.push(...collectDbTableTests(entryPath));
        } else if (entry.isFile() && entry.name.endsWith('.test.mjs')) {
            files.push(entryPath);
        }
    }

    return files.sort();
}

function streamLines(stream, label) {
    return new Promise((resolve) => {
        let buffer = '';
        stream.setEncoding('utf8');
        stream.on('data', (chunk) => {
            buffer += chunk;
            let index;
            while ((index = buffer.indexOf('\n')) !== -1) {
                const line = buffer.slice(0, index);
                buffer = buffer.slice(index + 1);
                if (line.trim()) {
                    console.log(`${COLOR_INFO}[${label}]${COLOR_RESET} ${line}`);
                } else {
                    console.log(line);
                }
            }
        });
        stream.on('end', () => {
            if (buffer.length) {
                console.log(`${COLOR_INFO}[${label}]${COLOR_RESET} ${buffer}`);
            }
            resolve();
        });
    });
}

async function runSingleTest(filePath) {
    const relativePath = relative(testsRoot, filePath);
    console.log(`${COLOR_INFO}▶ Running ${relativePath}${COLOR_RESET}`);
    const start = Date.now();

    const child = spawn('node', ['--test', relativePath], {
        cwd: testsRoot,
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    let timedOut = false;
    const timeout = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
    }, TEST_TIMEOUT_MS);

    await Promise.all([
        streamLines(child.stdout, 'stdout'),
        streamLines(child.stderr, 'stderr'),
        new Promise((resolve) => child.on('exit', resolve)),
    ]);
    clearTimeout(timeout);

    const durationMs = Date.now() - start;
    const exitCode = timedOut ? 1 : (child.exitCode ?? 0);
    const status = exitCode === 0 ? 'PASS' : (timedOut ? 'TIMEOUT' : 'FAIL');
    const colour = exitCode === 0 ? COLOR_PASS : COLOR_FAIL;
    if (timedOut) {
        console.log(`${COLOR_WARN}Test timed out after ${TEST_TIMEOUT_MS} ms${COLOR_RESET}`);
    }
    console.log(`${colour}${status}${COLOR_RESET} ${relativePath} (${durationMs} ms)\n`);

    return {
        file: relativePath,
        exitCode,
        durationMs,
        timedOut,
    };
}

async function main() {
    const testFiles = collectDbTableTests();
    if (!testFiles.length) {
        console.log(`${COLOR_WARN}No DB table tests found under tests/dbtableSkills.${COLOR_RESET}`);
        process.exit(0);
    }

    const results = [];
    for (const filePath of testFiles) {
        // eslint-disable-next-line no-await-in-loop
        const result = await runSingleTest(filePath);
        results.push(result);
    }

    const failed = results.filter((result) => result.exitCode !== 0);
    console.log('Summary');
    console.log('-------');
    console.log(`Total: ${results.length}`);
    console.log(`Passed: ${results.length - failed.length}`);
    console.log(`Failed: ${failed.length}`);

    if (failed.length) {
        console.log('\nFailed Tests:');
        failed.forEach((result) => {
            console.log(` - ${result.file} (${result.durationMs} ms)`);
        });
        process.exit(1);
    }
}

await main();
