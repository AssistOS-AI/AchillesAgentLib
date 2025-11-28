import fs from 'node:fs';
import path from 'node:path';
import GampRSP from '../../../GampRSP.mjs';

const COMMENT_PREFIX = (ext) => {
    if (['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx'].includes(ext)) {
        return '//';
    }
    if (ext === '.json') {
        return '//';
    }
    if (ext === '.py') {
        return '#';
    }
    return '#';
};

const ensureDir = (dirPath) => {
    fs.mkdirSync(dirPath, { recursive: true });
};

const parseBulletList = (text = '') => text
    .split('\n')
    .map((line) => line.replace(/^-+\s*/, '').trim())
    .filter(Boolean);

const extractFileImpacts = (dsPath, dsId) => {
    const content = fs.readFileSync(dsPath, 'utf8');
    const regex = /###\s+File:\s+(.+?)\n([\s\S]*?)(?=\n###\s+File:|\n##\s+|$)/g;
    const impacts = [];
    let match;
    while ((match = regex.exec(content)) !== null) {
        const [, filePath, block] = match;
        const sectionRegex = /####\s+([^\n]+)\n([\s\S]*?)(?=####\s+|$)/g;
        const sections = {};
        let sectionMatch;
        while ((sectionMatch = sectionRegex.exec(block)) !== null) {
            sections[sectionMatch[1].toLowerCase()] = sectionMatch[2].trim();
        }
        const timestampMatch = block.match(/Timestamp:\s*(\d+)/i);
        impacts.push({
            dsId,
            filePath: filePath.trim(),
            timestamp: timestampMatch ? Number(timestampMatch[1]) : Date.now(),
            sections,
            exports: parseBulletList(sections.exports),
            dependencies: parseBulletList(sections.dependencies),
        });
    }
    return impacts;
};

const buildGenerationPrompt = (impact, dsText) => {
    const sections = impact.sections || {};
    return [
        '# Build Source File From Specification',
        `Design spec: ${impact.dsId}`,
        `Target path: ${impact.filePath}`,
        '',
        '## Why (intent)',
        sections.why || 'Purpose not described.',
        '',
        '## How (approach)',
        sections.how || 'Implementation approach pending.',
        '',
        '## What (deliverable)',
        sections.what || 'Deliverable summary missing.',
        '',
        '## Operational Considerations',
        `Side effects: ${sections['side effects'] || 'None noted.'}`,
        `Concurrency: ${sections.concurrency || 'Not specified.'}`,
        '',
        '## Detailed description',
        sections.description || 'No additional description provided.',
        '',
        '## Full DS Context',
        dsText.slice(0, 4_000),
        '',
        'Return ONLY the full file content enclosed in a single code block.',
    ].join('\n');
};

const buildFallbackStub = (impact, prefix) => {
    const sections = impact.sections || {};
    const lines = [
        `${prefix} WHY: ${sections.why || 'Purpose not documented.'}`,
        `${prefix} HOW: ${sections.how || 'Implementation details pending from DS.'}`,
        `${prefix} WHAT: ${sections.what || 'Deliverable summary missing in DS.'}`,
        `${prefix} Side effects: ${sections['side effects'] || 'None noted.'}`,
        `${prefix} Concurrency: ${sections.concurrency || 'Not specified.'}`,
        `${prefix} TODO: Implement according to DS ${impact.dsId}.`,
    ];
    return lines.join('\n');
};

const ensureFileFromImpact = async ({
    impact,
    workspaceRoot,
    llmAgent,
    dsText,
}) => {
    const targetPath = path.join(workspaceRoot, impact.filePath);
    const ext = path.extname(targetPath).toLowerCase();
    const prefix = COMMENT_PREFIX(ext);
    const banner = `${prefix} Managed by ${impact.dsId} (timestamp ${impact.timestamp})`;
    const existed = fs.existsSync(targetPath);
    if (existed) {
        const existing = fs.readFileSync(targetPath, 'utf8');
        if (existing.includes(banner)) {
            return { status: 'skipped', filePath: impact.filePath };
        }
    }

    let body = '';
    if (llmAgent && typeof llmAgent.executePrompt === 'function') {
        try {
            const generated = await llmAgent.executePrompt(buildGenerationPrompt(impact, dsText), {
                responseShape: 'code',
                context: {
                    intent: 'build-code-generate',
                    dsId: impact.dsId,
                    filePath: impact.filePath,
                },
            });
            if (generated && typeof generated === 'string' && generated.trim()) {
                body = generated.trim();
            }
        } catch (error) {
            if (process.env.ACHILES_DEBUG === 'true') {
                console.warn(`[build-code] LLM generation failed for ${impact.filePath}: ${error.message}`);
            }
        }
    }

    if (!body) {
        body = buildFallbackStub(impact, prefix);
    }

    const content = `${banner}\n${body}\n`;
    ensureDir(path.dirname(targetPath));
    fs.writeFileSync(targetPath, content);
    return {
        status: existed ? 'updated' : 'created',
        filePath: impact.filePath,
    };
};

const parseEnvFile = (filePath) => {
    const content = fs.readFileSync(filePath, 'utf8');
    return content.split(/\r?\n/).reduce((acc, line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) {
            return acc;
        }
        const [key, ...rest] = trimmed.split('=');
        if (!key) {
            return acc;
        }
        acc[key.trim()] = rest.join('=').trim();
        return acc;
    }, {});
};

const ensureTestUtil = (workspaceRoot) => {
    const utilDir = path.join(workspaceRoot, 'tests', 'testUtil');
    ensureDir(utilDir);
    const target = path.join(utilDir, 'index.mjs');
    const content = `import fs from 'node:fs';
import path from 'node:path';

const ENV_FILES = ['.env', '.enf'];

const ensureDir = (dirPath) => {
    fs.mkdirSync(dirPath, { recursive: true });
};

const parseEnvFile = (filePath) => {
    const text = fs.readFileSync(filePath, 'utf8');
    return text.split(/\\r?\\n/).reduce((acc, line) => {
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
    const runDir = path.join(tempRoot, \`run-\${Date.now()}-\${Math.random().toString(16).slice(2)}\`);
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
                throw new Error(\`Missing required environment variables: \${missing.join(', ')}\`);
            }
        },
    };
};
`;
    fs.writeFileSync(target, content);
    return target;
};

const buildSuiteTestTemplate = (reqId) => `import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSuiteContext } from '../testUtil/index.mjs';

const suite = createSuiteContext('${reqId}', { timeoutMs: 20_000 });

test('[${reqId}] specification entry exists', { timeout: suite.timeoutMs }, () => {
    const docName = suite.suiteName.startsWith('NFS') ? 'NFS.md' : 'FS.md';
    const docPath = path.join(suite.workspaceRoot, '.specs', docName);
    const content = fs.readFileSync(docPath, 'utf8');
    assert.ok(content.includes('${reqId}'), 'Specification entry must be present in the corresponding document.');
});

test('[${reqId}] temporary workspace prepared', { timeout: suite.timeoutMs }, () => {
    const marker = path.join(suite.tempDir, 'context.json');
    fs.writeFileSync(marker, JSON.stringify({ suite: suite.suiteName, timestamp: Date.now() }, null, 2));
    assert.ok(fs.existsSync(marker), 'Temporary execution folder must contain the context marker.');
});
`;

const ensureRunAllTests = (workspaceRoot) => {
    const target = path.join(workspaceRoot, 'runAlltests.js');
    const testsRoot = path.join(workspaceRoot, 'tests');
    ensureDir(testsRoot);
    const script = `#!/usr/bin/env node
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
    .filter((entry) => /^FS-\\d+|^NFS-\\d+/.test(entry));

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
        console.warn(\`[warn] Suite \${suiteName} has no test files.\`);
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
`;
    fs.writeFileSync(target, script);
    fs.chmodSync(target, 0o755);
    return target;
};

const ensureSuiteTests = (workspaceRoot) => {
    const testsRoot = path.join(workspaceRoot, 'tests');
    ensureDir(testsRoot);
    const utilPath = ensureTestUtil(workspaceRoot);
    const suites = [
        ...GampRSP.collectIds('FS.md', 'FS'),
        ...GampRSP.collectIds('NFS.md', 'NFS'),
    ];
    suites.forEach((reqId) => {
        const suiteDir = path.join(testsRoot, reqId);
        ensureDir(suiteDir);
        const testPath = path.join(suiteDir, `${reqId.toLowerCase()}.test.mjs`);
        if (!fs.existsSync(testPath)) {
            fs.writeFileSync(testPath, buildSuiteTestTemplate(reqId));
        }
    });
    const runnerPath = ensureRunAllTests(workspaceRoot);
    return {
        suites,
        utilPath,
        runnerPath,
    };
};

export async function action({ context }) {
    const workspaceRoot = context.workspaceRoot || process.cwd();
    const llmAgent = context.llmAgent || null;
    GampRSP.configure(workspaceRoot);
    const dsDir = GampRSP.getDSDir();
    const entries = fs.readdirSync(dsDir)
        .filter((entry) => entry.toUpperCase().startsWith('DS-') && entry.endsWith('.md'));
    const dsTextCache = new Map();
    const manifest = {
        created: [],
        updated: [],
        skipped: [],
    };

    for (const entry of entries) {
        const dsId = entry.replace('.md', '');
        const dsPath = path.join(dsDir, entry);
        const dsText = fs.readFileSync(dsPath, 'utf8');
        dsTextCache.set(dsId, dsText);
        const impacts = extractFileImpacts(dsPath, dsId);
        // eslint-disable-next-line no-await-in-loop
        for (const impact of impacts) {
            // eslint-disable-next-line no-await-in-loop
            const outcome = await ensureFileFromImpact({
                impact,
                workspaceRoot,
                llmAgent,
                dsText,
            });
            manifest[outcome.status].push(impact.filePath);
        }
    }

    const testScaffold = ensureSuiteTests(workspaceRoot);

    return {
        message: 'Build code completed.',
        manifest,
        testScaffold,
    };
}

export default action;
