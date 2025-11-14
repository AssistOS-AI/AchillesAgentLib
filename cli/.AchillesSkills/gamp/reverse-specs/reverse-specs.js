import fs from 'node:fs';
import path from 'node:path';
import GampRSP from '../../../GampRSP.mjs';

const SOURCE_EXTS = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.json', '.html', '.css', '.md', '.yml', '.yaml']);

const listFiles = (root, ignores) => {
    const queue = [root];
    const results = [];
    const shouldIgnore = (entry) => {
        const rel = path.relative(root, entry);
        if (!rel || rel.startsWith('..')) {
            return false;
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

const readSnippet = (filePath, limit = 240) => {
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        return content.slice(0, limit).replace(/\s+/g, ' ').trim();
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

export async function action({ prompt, context }) {
    const workspaceRoot = context.workspaceRoot || process.cwd();
    GampRSP.configure(workspaceRoot);
    const ignores = GampRSP.readIgnoreList();
    const files = listFiles(workspaceRoot, ignores);
    const autoIds = ensureAutoSpecAnchors();

    files.forEach((filePath) => {
        const relative = path.relative(workspaceRoot, filePath);
        const snippet = readSnippet(filePath);
        const exports = parseExports(filePath);
        GampRSP.describeFile(
            autoIds.dsId,
            relative,
            snippet || 'Source file detected.',
            exports,
            [],
        );
    });

    return {
        message: 'Reverse specs completed.',
        filesProcessed: files.length,
        dsId: autoIds.dsId,
    };
}

export default action;
