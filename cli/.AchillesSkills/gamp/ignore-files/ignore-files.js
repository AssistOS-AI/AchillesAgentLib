import path from 'node:path';
import GampRSP from '../../../GampRSP.mjs';

const DEFAULT_PATTERNS = [
    'node_modules',
    '.git',
    'dist',
    'coverage',
    '.cache',
    '.specs/mock',
    '.specs/html_docs',
];

const parseList = (prompt = '') => {
    if (!prompt || typeof prompt !== 'string') {
        return [];
    }
    return prompt
        .replace(/,/g, '\n')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
};

const normaliseEntry = (entry, root) => {
    const cleaned = entry
        .replace(/["']/g, '')
        .trim();
    if (!cleaned) {
        return null;
    }
    const absolute = path.resolve(root, cleaned);
    if (absolute.startsWith(root)) {
        return path.relative(root, absolute) || '.';
    }
    return cleaned;
};

export async function action({ prompt, context }) {
    const workspaceRoot = context.workspaceRoot || process.cwd();
    GampRSP.configure(workspaceRoot);

    const entries = parseList(prompt);
    const combined = DEFAULT_PATTERNS.concat(entries);
    const normalised = combined
        .map((entry) => normaliseEntry(entry, workspaceRoot))
        .filter(Boolean);

    const updated = GampRSP.addIgnoreEntries(normalised);
    return {
        message: 'Ignore list updated.',
        entries: updated,
    };
}

export default action;
