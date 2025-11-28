import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { Writable } from 'node:stream';

const looksLikeEnvelope = (text) => {
    if (typeof text !== 'string') {
        return false;
    }
    const trimmed = text.trim();
    return trimmed.includes('"__webchatMessage"')
        && trimmed.includes('"version"')
        && trimmed.includes('"text"')
        && trimmed.includes('"attachments"');
};

const HISTORY_FILENAME = '.prompts_history';
const MAX_HISTORY_ENTRIES = 200;

class PromptManager {
    constructor({
        specsRoot,
        workspaceRoot,
        input = process.stdin,
        output = process.stdout,
    } = {}) {
        this.specsRoot = specsRoot || path.join(workspaceRoot || process.cwd(), '.specs');
        this.input = input;
        this.output = output;
        this.historyEntries = [];
        this.historyFile = path.join(this.specsRoot, HISTORY_FILENAME);
        this.readline = null;
        this.filterStream = null;
        this._loadHistoryFromDisk();
    }

    _loadHistoryFromDisk() {
        if (!this.specsRoot) {
            return;
        }
        try {
            fs.mkdirSync(this.specsRoot, { recursive: true });
        } catch {
            // ignore
        }

        if (!fs.existsSync(this.historyFile)) {
            this.historyEntries = [];
            return;
        }
        try {
            this.historyEntries = fs.readFileSync(this.historyFile, 'utf8')
                .split(/\r?\n/)
                .map((line) => line.trim())
                .filter(Boolean);
        } catch {
            this.historyEntries = [];
        }
    }

    _saveHistory() {
        if (!this.historyEntries.length) {
            return;
        }
        const trimmed = this.historyEntries.slice(-MAX_HISTORY_ENTRIES);
        this.historyEntries = trimmed;
        try {
            fs.mkdirSync(path.dirname(this.historyFile), { recursive: true });
            fs.writeFileSync(this.historyFile, `${trimmed.join('\n')}\n`);
        } catch {
            // ignore write errors
        }
    }

    _createFilterStream() {
        if (this.filterStream) {
            return this.filterStream;
        }
        this.filterStream = new Writable({
            write: (chunk, encoding, callback) => {
                const text = typeof chunk === 'string' ? chunk : (chunk ? chunk.toString() : '');
                if (text && !looksLikeEnvelope(text)) {
                    this.output.write(chunk, encoding, callback);
                } else if (typeof callback === 'function') {
                    callback();
                }
            },
        });
        return this.filterStream;
    }

    _ensureReadline() {
        if (this.readline) {
            return this.readline;
        }
        const filterStream = this._createFilterStream();
        const historySnapshot = this.historyEntries.slice().reverse();
        this.readline = readline.createInterface({
            input: this.input,
            output: filterStream,
            terminal: true,
            history: historySnapshot,
            removeHistoryDuplicates: true,
        });
        this.readline.history = historySnapshot;
        this.readline.on('close', () => {
            this.readline = null;
        });
        return this.readline;
    }

    record(entry) {
        if (!entry || typeof entry !== 'string') {
            return;
        }
        const trimmed = entry.trim();
        if (!trimmed) {
            return;
        }
        const last = this.historyEntries[this.historyEntries.length - 1];
        if (last === trimmed) {
            return;
        }
        this.historyEntries.push(trimmed);
        if (this.readline) {
            this.readline.history = this.historyEntries.slice().reverse();
        }
        this._saveHistory();
    }

    async ask(message) {
        const rl = this._ensureReadline();
        return new Promise((resolve) => rl.question(
            message,
            (answer) => resolve(answer.replace(/\x01/g, '\n')),
        ));
    }

    async readMultiline(initialPrompt = 'achilles> ', continuationPrompt = '... ') {
        const rl = this._ensureReadline();
        rl.history = this.historyEntries.slice().reverse();
        const lines = [];
        let expectingContinuation = false;

        while (true) {
            // eslint-disable-next-line no-await-in-loop
            const value = await new Promise((resolve) => rl.question(
                expectingContinuation ? continuationPrompt : initialPrompt,
                (answer) => resolve(answer.replace(/\x01/g, '\n')),
            ));
            const trimmed = value.trim();

            if (!expectingContinuation && trimmed.startsWith('/')) {
                this.record(trimmed);
                return { command: trimmed };
            }

            if (!expectingContinuation && !trimmed) {
                continue;
            }

            const continuationMatch = value.match(/\\\s*$/);
            const hasContinuation = Boolean(continuationMatch);
            const lineValue = hasContinuation
                ? value.slice(0, value.length - continuationMatch[0].length)
                : value;

            if (lineValue || lines.length || hasContinuation) {
                lines.push(lineValue);
            }

            if (hasContinuation) {
                expectingContinuation = true;
                continue;
            }

            break;
        }

        const finalText = lines.join('\n').trim();
        if (finalText) {
            this.record(finalText);
        }
        return { text: finalText };
    }

    close() {
        if (this.readline) {
            this.readline.close();
            this.readline = null;
        }
        this.filterStream = null;
    }
}

export { PromptManager };
export default PromptManager;
