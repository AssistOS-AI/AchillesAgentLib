#!/usr/bin/env node
import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

const cliTestFiles = [
    path.join(repoRoot, 'tests', 'cli', 'gamp', 'achilles-cli.test.mjs'),
    path.join(repoRoot, 'tests', 'cli', 'gamp', 'workspace-workflows.test.mjs'),
    path.join(repoRoot, 'tests', 'cli', 'gamp', 'spec-mentor.test.mjs'),
];

const extraArgs = process.argv.slice(2);
const child = spawn('node', ['--test', ...cliTestFiles, ...extraArgs], {
    stdio: 'inherit',
});

child.on('exit', (code) => {
    process.exit(typeof code === 'number' ? code : 0);
});
