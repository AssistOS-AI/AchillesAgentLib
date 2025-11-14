import fs from 'node:fs';
import path from 'node:path';

const ENV_FILES = ['.env', '.enf'];

const ensureDir = (dirPath) => {
    fs.mkdirSync(dirPath, { recursive: true });
};

const parseEnvFile = (filePath) => {
    const text = fs.readFileSync(filePath, 'utf8');
    return text.split(/\r?\n/).reduce((acc, line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) {
            return acc;
        }
        const [key, ...rest] = trimmed.split('=');
        if (key) {
            acc[key.trim()] = rest.join('=').trim();
        }
        return acc;
    }, {});
};

const loadEnvFromAncestors = (workspaceRoot) => {
    const env = {};
    let current = workspaceRoot;
    while (true) {
        ENV_FILES.forEach((name) => {
            const candidate = path.join(current, name);
            if (fs.existsSync(candidate)) {
                Object.assign(env, parseEnvFile(candidate));
            }
        });
        const parent = path.dirname(current);
        if (parent === current) {
            break;
        }
        current = parent;
    }
    return env;
};

const ensureTempFolder = (workspaceRoot, suiteName) => {
    const tempRoot = path.join(workspaceRoot, 'tests', '.tmp', suiteName.toLowerCase());
    ensureDir(tempRoot);
    const runs = fs.readdirSync(tempRoot).filter((entry) => entry.startsWith('run-'));
    runs.forEach((entry) => {
        fs.rmSync(path.join(tempRoot, entry), { recursive: true, force: true });
    });
    const runDir = path.join(tempRoot, `run-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    fs.mkdirSync(runDir, { recursive: true });
    return runDir;
};

const locateWorkspaceRoot = (startDir) => {
    let current = startDir;
    while (current && current !== path.dirname(current)) {
        if (fs.existsSync(path.join(current, '.specs'))) {
            return current;
        }
        current = path.dirname(current);
    }
    return startDir;
};

export const createSuiteContext = (suiteName, options = {}) => {
    const workspaceRoot = locateWorkspaceRoot(process.cwd());
    const tempDir = ensureTempFolder(workspaceRoot, suiteName);
    const env = loadEnvFromAncestors(workspaceRoot);
    const timeoutMs = Number(process.env.ACHILLES_TEST_TIMEOUT_MS)
        || Number(options.timeoutMs)
        || 30_000;
    return {
        suiteName,
        workspaceRoot,
        tempDir,
        timeoutMs,
        env,
        requireEnv(required = []) {
            const missing = required
                .map((key) => key.trim())
                .filter((key) => key && !(process.env[key] ?? env[key]));
            if (missing.length) {
                throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
            }
        },
    };
};
