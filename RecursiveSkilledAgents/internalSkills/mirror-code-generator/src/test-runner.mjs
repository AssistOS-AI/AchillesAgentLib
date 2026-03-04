import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

async function runAllTestsOnDisk(skillDir, logger = console) {
    const execFileAsync = promisify(execFile);
    const testsDir = path.join(skillDir, 'tests');
    const runnerPath = path.join(testsDir, 'runAll.mjs');
    const exists = await fs.stat(runnerPath).then(stat => stat.isFile()).catch(() => false);
    if (!exists) {
        logger.warn(`[generateMirrorCode] runAll.mjs not found in ${testsDir}. Skipping tests.`);
        return { failedTests: [], skipped: true };
    }

    try {
        const { stdout } = await execFileAsync('node', [runnerPath], { cwd: testsDir, maxBuffer: 10 * 1024 * 1024 });
        const parsed = JSON.parse(stdout);
        if (!parsed || !Array.isArray(parsed.failedTests)) {
            throw new Error('runAll.mjs returned invalid results.');
        }
        return parsed;
    } catch (error) {
        const stderr = error?.stderr ? String(error.stderr) : '';
        const stdout = error?.stdout ? String(error.stdout) : '';
        const message = error?.message ? String(error.message) : '';
        const details = [message, stderr, stdout].filter(Boolean).join('\n');
        logger.warn(`[generateMirrorCode] runAll.mjs execution failed.\n${details}`);
        return { failedTests: [], skipped: false, error: details };
    }
}

export { runAllTestsOnDisk };
