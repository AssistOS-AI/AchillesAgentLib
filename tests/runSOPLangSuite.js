#!/usr/bin/env node
import { readdirSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const COLOR_RESET = '\x1b[0m';
const COLOR_TEST = '\x1b[37m';
const COLOR_DETAIL = '\x1b[90m';
const COLOR_WARN = '\x1b[33m';
const COLOR_PASS = '\x1b[32m';
const COLOR_FAIL = '\x1b[31m';

const rootPath = fileURLToPath(new URL('.', import.meta.url));
const suiteRoot = join(rootPath, 'lightSOPLang');

function collectTestFiles(dirPath = suiteRoot) {
    const collected = [];
    const entries = readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
        if (entry.name.startsWith('.')) {
            continue;
        }
        const entryPath = join(dirPath, entry.name);
        if (entry.isDirectory()) {
            collected.push(...collectTestFiles(entryPath));
            continue;
        }
        if (extname(entry.name) !== '.mjs') {
            continue;
        }
        collected.push(entryPath);
    }

    return collected.sort();
}

function streamLines(stream, onLine) {
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

async function runSingleTest(absolutePath) {
    const relativePath = relative(rootPath, absolutePath);
    console.log(`${COLOR_TEST}${relativePath}${COLOR_RESET}`);

    const child = spawn('node', ['--test', absolutePath], {
        stdio: ['ignore', 'pipe', 'pipe'],
        cwd: rootPath,
    });

    const stdoutLines = [];
    const stderrLines = [];

    await Promise.all([
        streamLines(child.stdout, (line) => {
            stdoutLines.push(line);
            console.log(`${COLOR_DETAIL}${line}${COLOR_RESET}`);
        }),
        streamLines(child.stderr, (line) => {
            stderrLines.push(line);
            const colour = line.trim() ? COLOR_WARN : COLOR_DETAIL;
            console.log(`${colour}${line}${COLOR_RESET}`);
        }),
        new Promise((resolve) => child.on('exit', resolve)),
    ]);

    const exitCode = child.exitCode ?? 0;
    const passed = exitCode === 0;
    const statusLabel = passed
        ? `${COLOR_PASS}PASS${COLOR_RESET}`
        : `${COLOR_FAIL}FAIL${COLOR_RESET}`;

    console.log(`${statusLabel} ${COLOR_TEST}${relativePath}${COLOR_RESET}`);

    return {
        file: relativePath,
        passed,
        exitCode,
        stdout: stdoutLines,
        stderr: stderrLines,
    };
}

async function main() {
    let testFiles;
    try {
        testFiles = collectTestFiles();
    } catch (error) {
        console.error(`${COLOR_FAIL}Failed to read tests/lightSOPLang: ${error.message}${COLOR_RESET}`);
        process.exit(1);
    }

    if (!testFiles.length) {
        console.warn(`${COLOR_WARN}No LightSOPLang tests found.${COLOR_RESET}`);
        process.exit(0);
    }

    const results = [];
    for (const filePath of testFiles) {
        // eslint-disable-next-line no-await-in-loop
        const result = await runSingleTest(filePath);
        results.push(result);
        if (!result.passed) {
            console.log(`${COLOR_WARN}---${COLOR_RESET}`);
        }
    }

    const failed = results.filter(result => !result.passed);

    console.log('\nLightSOPLang Test Summary');
    console.log('------------------------');
    console.log(`${COLOR_TEST}Total:${COLOR_RESET} ${results.length}`);
    console.log(`${COLOR_PASS}Passed:${COLOR_RESET} ${results.length - failed.length}`);
    console.log(`${COLOR_FAIL}Failed:${COLOR_RESET} ${failed.length}`);

    if (failed.length) {
        console.log('\nFailed Tests');
        failed.forEach((result) => {
            console.log(` - ${result.file}`);
            const diagnosticLines = [
                ...result.stderr.filter(Boolean),
                ...result.stdout.filter(Boolean),
            ].slice(0, 5);
            if (diagnosticLines.length) {
                diagnosticLines.forEach((line) => {
                    console.log(`   ${COLOR_DETAIL}${line}${COLOR_RESET}`);
                });
            } else {
                console.log('   No diagnostic output captured.');
            }
        });
    }

    process.exit(failed.length ? 1 : 0);
}

main().catch((error) => {
    console.error(`${COLOR_FAIL}Unexpected error while running LightSOPLang suite:${COLOR_RESET}`);
    console.error(`${COLOR_FAIL}${error?.stack || error}${COLOR_RESET}`);
    process.exit(1);
});
