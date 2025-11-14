import fs from 'node:fs';
import path from 'node:path';
import GampRSP from '../../../GampRSP.mjs';
import {
    ensureLLM,
    summariseSpecs,
    parsePlan,
    executePlan,
} from '../utils/specPlanner.mjs';

const SOURCE_EXTS = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.json', '.html', '.css', '.md', '.yml', '.yaml']);
const MAX_FILES = 80;

const listFiles = (root, ignores) => {
    const queue = [root];
    const results = [];
    const shouldIgnore = (entry) => {
        const rel = path.relative(root, entry);
        if (!rel || rel.startsWith('..')) {
            return false;
        }
        if (rel === '.specs' || rel.startsWith('.specs/')) {
            return true;
        }
        return ignores.some((ignore) => {
            if (!ignore) {
                return false;
            }
            return rel === ignore || rel.startsWith(`${ignore}/`);
        });
    };

    while (queue.length) {
        const current = queue.shift();
        if (shouldIgnore(current)) {
            continue;
        }
        const stat = fs.statSync(current);
        if (stat.isDirectory()) {
            fs.readdirSync(current).forEach((entry) => queue.push(path.join(current, entry)));
            continue;
        }
        if (!stat.isFile()) {
            continue;
        }
        const ext = path.extname(current).toLowerCase();
        if (!SOURCE_EXTS.has(ext)) {
            continue;
        }
        results.push(current);
    }
    return results;
};

const readSnippet = (filePath, limit = 480) => {
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        return content.slice(0, limit).trim();
    } catch {
        return '';
    }
};

const parseExports = (filePath) => {
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        const matches = content.match(/export\s+(?:default\s+)?([a-zA-Z0-9_]+)/g) || [];
        return matches.map((entry) => entry.replace(/export\s+(?:default\s+)?/, '').trim());
    } catch {
        return [];
    }
};

const ensureAutoSpecAnchors = () => {
    const cache = GampRSP.readCache();
    if (cache.autoReverse && cache.autoReverse.dsId) {
        return cache.autoReverse;
    }
    const ursId = GampRSP.createURS('Auto generated coverage', 'Automatically captured requirement for reverse engineered files.');
    const fsId = GampRSP.createFS('Auto functional coverage', 'Mirror workspace artefacts into the specification set.', ursId);
    const dsId = GampRSP.createDS('Auto DS (reverse specs)', 'Container for reverse engineered files.', 'Lightweight description derived from workspace scan.', ursId, fsId);
    const next = {
        ursId,
        fsId,
        dsId,
    };
    GampRSP.writeCache({
        ...cache,
        autoReverse: next,
    });
    return next;
};

const buildFilePrompt = ({
    relativePath,
    snippet,
    exportsList,
    specs,
}) => {
    const sections = [
        '# Reverse Specs Planner',
        'Align the specification docs with the provided source file.',
        'Respond ONLY with a JSON array of GampRSP actions (same format as update-specs).',
        'If the file already matches an existing DS, update that DS and call describeFile.',
        'Prefer reusing existing URS/FS/NFS identifiers when possible.',
        '',
        '## File Under Analysis',
        `Path: ${relativePath}`,
        '',
        '### Snippet',
        '```',
        snippet || '<empty>',
        '```',
        '',
        `### Detected exports: ${JSON.stringify(exportsList)}`,
        '',
        '## Current Specs Snapshot (truncated)',
        specs || '<empty>',
        '',
        '## Response Format',
        '[{"action":"describeFile","dsId":"DS-001","filePath":"src/file.mjs",...}]',
    ];
    return sections.join('\n');
};

const fallbackDescribe = (dsId, relativePath, snippet, exportsList) => GampRSP.describeFile(
    dsId,
    relativePath,
    snippet || 'Source file detected.',
    exportsList,
    [],
    {
        why: `File ${relativePath} exists in the workspace and must be documented.`,
        how: 'Implementation is currently mirrored from the existing source file.',
        what: 'This entry tracks the deliverable so automation can regenerate it later.',
    },
);

export async function action({ prompt, context }) {
    const workspaceRoot = context.workspaceRoot || process.cwd();
    GampRSP.configure(workspaceRoot);
    const llm = ensureLLM(context);
    const specsSnapshot = summariseSpecs(8_000);
    const ignores = GampRSP.readIgnoreList();
    const files = listFiles(workspaceRoot, ignores).slice(0, MAX_FILES);
    const autoIds = ensureAutoSpecAnchors();
    const perFile = [];

    for (const filePath of files) {
        const relative = path.relative(workspaceRoot, filePath);
        const snippet = readSnippet(filePath);
        const exportsList = parseExports(filePath);
        let plan = [];

        try {
            const raw = await llm.executePrompt(buildFilePrompt({
                relativePath: relative,
                snippet,
                exportsList,
                specs: specsSnapshot,
            }), {
                responseShape: 'json',
                context: { intent: 'reverse-specs-plan', filePath: relative, userPrompt: prompt || '' },
            });
            plan = parsePlan(raw);
        } catch (error) {
            plan = [];
            if (process.env.ACHILES_DEBUG === 'true') {
                console.warn(`[reverse-specs] plan failure for ${relative}: ${error.message}`);
            }
        }

        const actions = plan.length
            ? executePlan(plan)
            : [{ action: 'describeFile', id: autoIds.dsId, filePath: relative, fallback: true, note: fallbackDescribe(autoIds.dsId, relative, snippet, exportsList) }];
        perFile.push({
            file: relative,
            plannedActions: plan.length,
            outcomes: actions,
        });
    }

    return {
        message: 'Reverse specs completed.',
        filesProcessed: files.length,
        results: perFile,
    };
}

export default action;
