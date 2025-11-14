#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const args = process.argv.slice(2);
let requestedSuite = null;
for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--suite') {
        requestedSuite = args[i + 1] || null;
        break;
    }
}

const workspaceRoot = process.cwd();
const testsRoot = path.join(workspaceRoot, 'tests');
if (!fs.existsSync(testsRoot)) {
    console.error('tests directory not found.');
    process.exit(1);
}

const suites = fs.readdirSync(testsRoot)
    .filter((entry) => /^FS-\d+|^NFS-\d+/.test(entry));

const selected = requestedSuite
    ? suites.filter((entry) => entry.toUpperCase() === requestedSuite.toUpperCase())
    : suites;

if (!selected.length) {
    console.log('No matching test suites found.');
    process.exit(0);
}

const runSuite = (suiteName) => new Promise((resolve) => {
    const suiteDir = path.join(testsRoot, suiteName);
    const testFiles = fs.readdirSync(suiteDir).filter((entry) => entry.endsWith('.test.mjs'));
    if (!testFiles.length) {
        console.warn(`[warn] Suite ${suiteName} has no test files.`);
        resolve(0);
        return;
    }
    const child = spawn('node', ['--test', ...testFiles], {
        cwd: suiteDir,
        stdio: 'inherit',
    });
    child.on('exit', (code) => resolve(typeof code === 'number' ? code : 0));
});

let exitCode = 0;
for (const suiteName of selected) {
    // eslint-disable-next-line no-await-in-loop
    const code = await runSuite(suiteName);
    if (code !== 0) {
        exitCode = code;
    }
}
process.exit(exitCode);
