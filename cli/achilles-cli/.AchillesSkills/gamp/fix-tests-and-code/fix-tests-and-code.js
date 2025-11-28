import { spawnSync } from 'node:child_process';
import path from 'node:path';
import GampRSP from '../../../GampRSP.mjs';
import buildCode from '../build-code/build-code.js';

const MAX_ATTEMPTS = 3;

const ensureAutoFixDs = () => {
    const cache = GampRSP.readCache();
    if (cache.fixLoop && cache.fixLoop.dsId) {
        return cache.fixLoop.dsId;
    }
    const ursId = GampRSP.createURS('Automated remediation', 'Tracks automatic fixes performed by fix-tests-and-code.');
    const fsId = GampRSP.createFS('Automated remediation FS', 'Records automated fixes executed by CI assistants.', ursId);
    const dsId = GampRSP.createDS('Fix loop DS', 'Documents automated attempts to repair tests and code.', 'Regeneration occurs via buildCode().', ursId, fsId);
    GampRSP.writeCache({
        ...cache,
        fixLoop: { dsId },
    });
    return dsId;
};

const runSuite = (workspaceRoot, suite) => {
    const scriptPath = path.join(workspaceRoot, 'runAlltests.js');
    const args = suite ? ['--suite', suite] : [];
    return spawnSync('node', [scriptPath, ...args], {
        cwd: workspaceRoot,
        encoding: 'utf8',
    });
};

export async function action({ prompt, context }) {
    const workspaceRoot = context.workspaceRoot || process.cwd();
    GampRSP.configure(workspaceRoot);
    const dsId = ensureAutoFixDs();
    const attempts = [];
    for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
        const result = runSuite(workspaceRoot, null);
        attempts.push({
            iteration: i + 1,
            exitCode: result.status,
            stdout: result.stdout,
            stderr: result.stderr,
        });
        if (result.status === 0) {
            return {
                message: 'All tests passed.',
                attempts,
            };
        }

        const note = [
            `### Attempt ${i + 1}`,
            `Timestamp: ${Date.now()}`,
            '',
            '```\n',
            result.stderr || result.stdout || 'No output captured.',
            '\n```',
        ].join('\n');
        GampRSP.appendToDS(dsId, note, '## Tests');
        await buildCode({ context });
    }

    return {
        message: 'Automated remediation exhausted attempts.',
        attempts,
    };
}

export default action;
