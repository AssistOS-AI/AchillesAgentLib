import { spawnSync } from 'node:child_process';
import path from 'node:path';
import GampRSP from '../../../GampRSP.mjs';

const extractSuite = (prompt = '') => {
    if (!prompt) {
        return null;
    }
    const match = prompt.match(/\b(FS|NFS|TEST)[-_]?\d+/i);
    return match ? match[0].toUpperCase().replace('_', '-') : null;
};

export async function action({ prompt, context }) {
    const workspaceRoot = context.workspaceRoot || process.cwd();
    GampRSP.configure(workspaceRoot);
    const suite = extractSuite(prompt);
    const scriptPath = path.join(workspaceRoot, 'runAlltests.js');
    const args = suite ? ['--suite', suite] : [];
    const child = spawnSync('node', [scriptPath, ...args], {
        cwd: workspaceRoot,
        encoding: 'utf8',
    });

    return {
        suite: suite || 'ALL',
        status: child.status === 0 ? 'passed' : 'failed',
        stdout: child.stdout,
        stderr: child.stderr,
        exitCode: child.status,
    };
}

export default action;
