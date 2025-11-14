#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

/**
 * List tests that should be temporarily excluded from `runSkillsTests.js`.
 * Paths are relative to the `tests/` directory and should use forward slashes.
 *
 * Example:
 * export const oldTests = [
 *     'useSkill/missingParameters.test.mjs',
 * ];
 */
export const oldTests = [
    // Add relative test paths here to skip them in the aggregated runner.
];

export default oldTests;

const COLOR_RESET = '\x1b[0m';
const COLOR_INFO = '\x1b[36m';
const COLOR_PASS = '\x1b[32m';
const COLOR_FAIL = '\x1b[31m';

const testsRoot = fileURLToPath(new URL('.', import.meta.url));
const useSkillRunner = path.join(testsRoot, 'useSkill', 'runAllTests.mjs');

async function runUseSkillSuite() {
    console.log(`${COLOR_INFO}Running legacy useSkill suite via ${path.relative(process.cwd(), useSkillRunner)}${COLOR_RESET}`);

    await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [useSkillRunner], {
            stdio: 'inherit',
            cwd: testsRoot,
        });
        child.on('exit', (code, signal) => {
            if (signal) {
                reject(new Error(`useSkill suite terminated via signal ${signal}`));
                return;
            }
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`useSkill suite exited with code ${code}`));
            }
        });
        child.on('error', reject);
    });
}

const executedDirectly = (() => {
    if (typeof process === 'undefined') {
        return false;
    }
    const currentFilePath = fileURLToPath(import.meta.url);
    const invokedPath = process.argv?.[1]
        ? path.resolve(process.cwd(), process.argv[1])
        : null;
    return invokedPath === currentFilePath;
})();

if (executedDirectly) {
    runUseSkillSuite()
        .then(() => {
            console.log(`${COLOR_PASS}useSkill tests completed successfully.${COLOR_RESET}`);
        })
        .catch((error) => {
            console.error(`${COLOR_FAIL}useSkill tests failed: ${error.message}${COLOR_RESET}`);
            process.exitCode = 1;
        });
}
