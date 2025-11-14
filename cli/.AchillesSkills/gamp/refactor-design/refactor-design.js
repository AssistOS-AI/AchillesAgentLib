import fs from 'node:fs';
import path from 'node:path';
import GampRSP from '../../../GampRSP.mjs';
import buildCode from '../build-code/build-code.js';

const FILE_PATTERN = /([A-Za-z0-9_\-./]+?\.(?:js|mjs|cjs|ts|tsx|jsx|json|css|html|md))/gi;
const DS_PATTERN = /DS[\s_-]?(\d{1,4})/gi;

const normaliseFilePath = (raw, workspaceRoot) => {
    if (!raw) {
        return null;
    }
    const cleaned = raw.replace(/["'`]/g, '').trim();
    if (!cleaned) {
        return null;
    }
    const unixish = cleaned.replace(/\\/g, '/');
    if (path.isAbsolute(unixish)) {
        if (unixish.startsWith(workspaceRoot)) {
            const relative = path.relative(workspaceRoot, unixish);
            return relative || '.';
        }
        return unixish;
    }
    return unixish;
};

const extractFileMentions = (prompt, workspaceRoot) => {
    const mentions = new Map();
    if (!prompt) {
        return mentions;
    }
    prompt.split(/\r?\n/).forEach((line) => {
        const matches = line.match(FILE_PATTERN);
        if (!matches) {
            return;
        }
        matches.forEach((match) => {
            const normalised = normaliseFilePath(match, workspaceRoot);
            if (!normalised || mentions.has(normalised)) {
                return;
            }
            mentions.set(normalised, line.trim() || `Refactor ${normalised}`);
        });
    });
    return mentions;
};

const deriveTitle = (prompt = '') => {
    const sentence = prompt
        .split(/[\r\n\.]+/)
        .map((entry) => entry.trim())
        .filter(Boolean)[0];
    const base = sentence || 'Refactor specification update';
    const trimmed = base.length > 72 ? `${base.slice(0, 69)}...` : base;
    return trimmed.startsWith('Refactor') ? trimmed : `Refactor – ${trimmed}`;
};

const buildScopeText = (prompt = '', timestamp = Date.now()) => {
    const details = prompt.trim() || 'Pending elaboration.';
    return `Refactor intent captured at ${new Date(timestamp).toISOString()}.\n\n${details}`;
};

const buildArchitectureText = (prompt = '') => {
    const lines = prompt
        .split(/[\r\n]+/)
        .map((entry) => entry.trim())
        .filter(Boolean);
    if (!lines.length) {
        return 'Architecture details pending.';
    }
    return [
        'Key design adjustments:',
        ...lines.map((line) => `- ${line}`),
    ].join('\n');
};

const normaliseDsId = (token) => {
    const digits = Number.parseInt(token, 10);
    if (!Number.isInteger(digits)) {
        return null;
    }
    return `DS-${String(digits).padStart(3, '0')}`;
};

const parseDsIds = (prompt) => {
    if (!prompt) {
        return [];
    }
    const matches = [];
    let detected;
    while ((detected = DS_PATTERN.exec(prompt)) !== null) {
        const formatted = normaliseDsId(detected[1]);
        if (formatted && !matches.includes(formatted)) {
            matches.push(formatted);
        }
    }
    return matches;
};

const readCurrentTitle = (dsId) => {
    const dsPath = path.join(GampRSP.getDSDir(), `${dsId}.md`);
    if (!fs.existsSync(dsPath)) {
        return `${dsId} design updates`;
    }
    const content = fs.readFileSync(dsPath, 'utf8');
    const pattern = new RegExp(`^#\\s+${dsId}\\s+[–-]\\s+(.*)$`, 'm');
    const match = content.match(pattern);
    return match ? match[1].trim() : `${dsId} design updates`;
};

const createDesignSpec = (prompt) => {
    const title = deriveTitle(prompt);
    const ursId = GampRSP.createURS(title, `Captured refactor intent: ${prompt || 'Pending details.'}`);
    const fsId = GampRSP.createFS(title, prompt || 'Refactor behaviour description pending.', ursId);
    const dsId = GampRSP.createDS(
        title,
        `Refactor scope recorded at ${new Date().toISOString()}.`,
        'Architecture will be refined as implementation progresses.',
        ursId,
        fsId,
    );
    return { ursId, fsId, dsId, title };
};

const annotateFiles = (dsId, prompt, workspaceRoot) => {
    const mentions = extractFileMentions(prompt, workspaceRoot);
    mentions.forEach((description, filePath) => {
        GampRSP.describeFile(dsId, filePath, description, [], []);
    });
    return mentions.size;
};

export async function action({ prompt = '', context = {} }) {
    const workspaceRoot = context.workspaceRoot || process.cwd();
    const executionContext = {
        ...context,
        workspaceRoot,
    };
    GampRSP.configure(workspaceRoot);
    const availableDs = new Set(GampRSP.listDSIds());
    const referenced = parseDsIds(prompt).filter((dsId) => availableDs.has(dsId));

    const created = [];
    const targetDsIds = referenced.length
        ? referenced
        : (() => {
            const spec = createDesignSpec(prompt);
            created.push(spec);
            return [spec.dsId];
        })();

    const timestamp = Date.now();
    const description = buildScopeText(prompt, timestamp);
    const architecture = buildArchitectureText(prompt);
    const annotatedFiles = [];

    targetDsIds.forEach((dsId) => {
        const title = readCurrentTitle(dsId);
        GampRSP.updateDS(dsId, title, description, architecture);
        const count = annotateFiles(dsId, prompt, workspaceRoot);
        annotatedFiles.push({ dsId, files: count });
    });

    const buildOutcome = await buildCode({ context: executionContext });

    return {
        message: 'Design specifications updated.',
        dsIds: targetDsIds,
        created,
        annotatedFiles,
        build: buildOutcome,
    };
}

export default action;
