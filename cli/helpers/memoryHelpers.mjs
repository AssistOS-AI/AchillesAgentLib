import fs from 'node:fs';
import path from 'node:path';

export const loadMemoryHistory = (cli, key) => {
    if (!cli.specsRoot) {
        return [];
    }
    const filePath = path.join(cli.specsRoot, `.history_${key}`);
    if (!fs.existsSync(filePath)) {
        return [];
    }
    try {
        const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (Array.isArray(raw?.history)) {
            return raw.history;
        }
    } catch {
        // ignore parse errors
    }
    return [];
};

export const persistMemory = (container, key) => {
    if (!container || typeof container.saveContext !== 'function') {
        return;
    }
    try {
        container.saveContext(key);
    } catch {
        // ignore persistence errors
    }
};

export const buildMemoryContext = (cli) => ({
    globalMemory: cli.globalMemory?.getFullContext() || [],
    userMemory: cli.userMemory?.getFullContext() || [],
    sessionMemory: cli.sessionMemory?.getFullContext() || [],
});

export default {
    loadMemoryHistory,
    persistMemory,
    buildMemoryContext,
};
