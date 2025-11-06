#!/usr/bin/env node
import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const cliTestsDir = path.resolve('tests/cli');

const pattern = path.join(cliTestsDir, '*.test.mjs');

const child = spawn('node', ['--test', pattern], {
    stdio: 'inherit',
});

child.on('exit', (code) => {
    process.exit(code ?? 0);
});
