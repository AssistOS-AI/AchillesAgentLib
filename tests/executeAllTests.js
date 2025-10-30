#!/usr/bin/env node
import fs, { readdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, extname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const COLOR_RESET = '\x1b[0m';
const COLOR_TEST = '\x1b[37m';
const COLOR_DETAIL = '\x1b[90m';
const COLOR_WARN = '\x1b[33m';
const COLOR_PASS = '\x1b[32m';
const COLOR_FAIL = '\x1b[31m';

const testsRoot = fileURLToPath(new URL('.', import.meta.url));
const iskillsRoot = join(testsRoot, 'iskills');

function collectSkillTests() {
    const testFiles = [];
    let scenarioDirs = [];

    try {
        scenarioDirs = readdirSync(iskillsRoot, { withFileTypes: true })
            .filter(entry => entry.isDirectory() && entry.name !== 'helpers');
    } catch (error) {
        console.error(`${COLOR_FAIL}Failed to read @tests/iskills directory: ${error.message}${COLOR_RESET}`);
        process.exit(1);
    }

    for (const dir of scenarioDirs) {
        const scenarioPath = join(iskillsRoot, dir.name);
        const entries = readdirSync(scenarioPath, { withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isFile()) {
                continue;
            }
            if (extname(entry.name) !== '.mjs') {
                continue;
            }
            if (!entry.name.endsWith('.test.mjs')) {
                continue;
            }
            testFiles.push(join(scenarioPath, entry.name));
        }
    }

    return testFiles.sort();
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

async function runSingleTest(absolutePath, logStream) {
    const relativePath = relative(testsRoot, absolutePath);
    console.log(`${COLOR_TEST}${relativePath}${COLOR_RESET}`);
    logStream.write(`=== ${relativePath} ===\n`);

    const child = spawn('node', ['--test', absolutePath], {
        stdio: ['ignore', 'pipe', 'pipe'],
        cwd: testsRoot,
    });

    const stdoutLines = [];
    const stderrLines = [];

    await Promise.all([
        streamLines(child.stdout, (line) => {
            stdoutLines.push(line);
            console.log(`${COLOR_DETAIL}${line}${COLOR_RESET}`);
            logStream.write(`[stdout] ${line}\n`);
        }),
        streamLines(child.stderr, (line) => {
            stderrLines.push(line);
            const colour = line.trim() ? COLOR_WARN : COLOR_DETAIL;
            console.log(`${colour}${line}${COLOR_RESET}`);
            logStream.write(`[stderr] ${line}\n`);
        }),
        new Promise((resolve) => child.on('exit', resolve)),
    ]);

    const exitCode = child.exitCode ?? 0;
    const passed = exitCode === 0;
    const statusLabel = passed
        ? `${COLOR_PASS}PASS${COLOR_RESET}`
        : `${COLOR_FAIL}FAIL${COLOR_RESET}`;
    console.log(`${statusLabel} ${COLOR_TEST}${relativePath}${COLOR_RESET}`);
    logStream.write(`${passed ? 'PASS' : 'FAIL'} ${relativePath}\n\n`);

    return {
        file: relativePath,
        exitCode,
        passed,
        stdout: stdoutLines,
        stderr: stderrLines,
    };
}

async function main() {
    const resultsPath = join(testsRoot, 'lastExecution.results');
    try {
        fs.unlinkSync(resultsPath);
    } catch (error) {
        if (error.code !== 'ENOENT') {
            console.warn(`${COLOR_WARN}Could not remove previous results file: ${error.message}${COLOR_RESET}`);
        }
    }

    const logStream = fs.createWriteStream(resultsPath, { flags: 'a', encoding: 'utf8' });
    logStream.write(`Interactive skill test run - ${new Date().toISOString()}\n\n`);

    const testFiles = collectSkillTests();
    if (!testFiles.length) {
        console.log(`${COLOR_WARN}No interactive skill tests found under @tests/iskills.${COLOR_RESET}`);
        logStream.write('No interactive skill tests found.\n');
        logStream.end();
        return;
    }

    const results = [];
    for (const filePath of testFiles) {
        // eslint-disable-next-line no-await-in-loop
        const result = await runSingleTest(filePath, logStream);
        results.push(result);
        if (result.exitCode !== 0) {
            console.log(`${COLOR_WARN}---${COLOR_RESET}`);
            logStream.write('---\n');
        }
    }

    const failed = results.filter(result => !result.passed);

    console.log('\nTest Summary');
    console.log('------------');
    console.log(`${COLOR_TEST}Total:${COLOR_RESET} ${results.length}`);
    console.log(`${COLOR_PASS}Passed:${COLOR_RESET} ${results.length - failed.length}`);
    console.log(`${COLOR_FAIL}Failed:${COLOR_RESET} ${failed.length}`);
    logStream.write('\nSummary\n');
    logStream.write(`Total: ${results.length}\n`);
    logStream.write(`Passed: ${results.length - failed.length}\n`);
    logStream.write(`Failed: ${failed.length}\n`);

    if (failed.length) {
        console.log('\nFailed Tests');
        failed.forEach((result) => {
            const failingStdout = result.stdout.filter((line) => line.includes('✖'));
            const detailLines = failingStdout.length
                ? failingStdout
                : result.stderr.filter(Boolean).slice(0, 5);
            const fallbackLines = result.stdout.filter(Boolean).slice(0, 5);
            const linesToPrint = detailLines.length ? detailLines : fallbackLines;

            console.log(` - ${result.file}`);
            logStream.write(` - ${result.file}\n`);

            if (linesToPrint.length) {
                linesToPrint.forEach((line) => {
                    console.log(`   ${COLOR_DETAIL}${line}${COLOR_RESET}`);
                    logStream.write(`   ${line}\n`);
                });
            } else {
                console.log('   No diagnostic output captured.');
                logStream.write('   No diagnostic output captured.\n');
            }
        });
    }

    logStream.end();
    process.exit(failed.length ? 1 : 0);
}

await main();
