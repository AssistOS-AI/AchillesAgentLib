import fs from 'node:fs';
import path from 'node:path';

function cloneHistory(history) {
    return history.map((entry) => ({ ...entry }));
}

export class MemoryContainer {
    constructor({ baseDir = process.cwd(), initialHistory = [] } = {}) {
        this.baseDir = baseDir;
        this.history = Array.isArray(initialHistory)
            ? initialHistory
                .filter((item) => item && typeof item === 'object')
                .map((item) => ({
                    user: typeof item.user === 'string' ? item.user : null,
                    ai: typeof item.ai === 'string' ? item.ai : null,
                    timestamp: item.timestamp || new Date().toISOString(),
                }))
            : [];
    }

    getFullContext() {
        return cloneHistory(this.history);
    }

    appendToHistory(entry) {
        if (!entry || typeof entry !== 'object') {
            throw new TypeError('appendToHistory expects an object with optional "user" and "ai" string fields.');
        }

        const record = {
            user: typeof entry.user === 'string' ? entry.user : null,
            ai: typeof entry.ai === 'string' ? entry.ai : null,
            timestamp: entry.timestamp || new Date().toISOString(),
        };

        this.history.push(record);
        return cloneHistory(this.history);
    }

    saveContext(sessionID) {
        const raw = typeof sessionID === 'string' || typeof sessionID === 'number'
            ? String(sessionID).trim()
            : '';
        if (!raw) {
            throw new Error('saveContext requires a non-empty sessionID string or number.');
        }

        const safeId = raw.replace(/[^A-Za-z0-9_\-]/g, '_');
        const fileName = `.history_${safeId}`;
        const targetPath = path.join(this.baseDir, fileName);

        const payload = JSON.stringify({
            savedAt: new Date().toISOString(),
            history: this.history,
        }, null, 2);

        fs.writeFileSync(targetPath, `${payload}\n`, 'utf8');
        return targetPath;
    }
}
