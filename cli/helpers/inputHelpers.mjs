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

export const initHistory = (cli) => {
    const baseSpecs = cli.specsRoot || path.join(cli.workspaceRoot, '.specs');
    try {
        fs.mkdirSync(baseSpecs, { recursive: true });
    } catch {
        // ignore directory creation issues
    }
    cli.historyFile = path.join(baseSpecs, '.prompts_history');
    if (fs.existsSync(cli.historyFile)) {
        try {
            const raw = fs.readFileSync(cli.historyFile, 'utf8');
            cli.historyEntries = raw
                .split(/\r?\n/)
                .map((line) => line.trim())
                .filter(Boolean);
        } catch {
            cli.historyEntries = [];
        }
    } else {
        cli.historyEntries = [];
    }
};

export const recordHistory = (cli, entry) => {
    if (!entry || !cli.historyFile) {
        return;
    }
    const trimmed = entry.trim();
    if (!trimmed) {
        return;
    }
    const last = cli.historyEntries[cli.historyEntries.length - 1];
    if (last === trimmed) {
        return;
    }
    cli.historyEntries.push(trimmed);
    const maxEntries = 200;
    if (cli.historyEntries.length > maxEntries) {
        cli.historyEntries.splice(0, cli.historyEntries.length - maxEntries);
    }
    try {
        fs.mkdirSync(path.dirname(cli.historyFile), { recursive: true });
        fs.writeFileSync(cli.historyFile, `${cli.historyEntries.join('\n')}\n`);
    } catch {
        // ignore persistence errors
    }
    if (cli.readline) {
        cli.readline.history = cli.historyEntries.slice().reverse();
    }
};

const createPromptFilterStream = (cli) => new Writable({
    write: (chunk, encoding, callback) => {
        const text = typeof chunk === 'string' ? chunk : (chunk ? chunk.toString() : '');
        if (text && !looksLikeEnvelope(text)) {
            cli.output.write(chunk, encoding, callback);
        } else if (typeof callback === 'function') {
            callback();
        }
    },
});

const buildCompleter = (cli) => {
    const commandList = [
        '/help',
        '/list',
        '/debug',
        '/continue',
        '/resume',
        '/status',
        '/cancel',
        '/specs',
        '/run',
        '/exit',
        '/quit',
    ];
    const skillCommands = cli.getSkillCatalog()
        .map((record) => `/run ${record.name}`);
    const completions = commandList.concat(skillCommands);
    return (line) => {
        const hits = completions.filter((entry) => entry.toLowerCase().startsWith(line.toLowerCase()));
        return [hits.length ? hits : completions, line];
    };
};

export const ensureReadline = (cli) => {
    if (cli.readline) {
        return cli.readline;
    }
    const filterStream = createPromptFilterStream(cli);
    const historySnapshot = cli.historyEntries.slice().reverse();
    cli.readline = readline.createInterface({
        input: cli.inputStream,
        output: filterStream,
        terminal: true,
        history: historySnapshot,
        completer: buildCompleter(cli),
        removeHistoryDuplicates: true,
    });
    cli.readline.history = historySnapshot;
    cli.readline.on('close', () => {
        cli.readline = null;
    });
    return cli.readline;
};

export const setupGlobalKeypressHandler = (cli, handler) => {
    const input = cli.inputStream;
    if (!input || typeof input.on !== 'function' || cli._keypressHandlerInitialized) {
        return;
    }
    if (typeof readline.emitKeypressEvents === 'function') {
        readline.emitKeypressEvents(input);
    }
    if (input.isTTY && typeof input.setRawMode === 'function') {
        try {
            input.setRawMode(true);
            cli._rawModeWasEnabled = true;
        } catch {
            // ignore raw mode errors
        }
    }
    cli._handleKeypressBound = handler;
    input.on('keypress', cli._handleKeypressBound);
    cli._keypressHandlerInitialized = true;
};

export const restoreInputMode = (cli) => {
    const input = cli.inputStream;
    if (cli._keypressHandlerInitialized && input && typeof input.off === 'function' && cli._handleKeypressBound) {
        input.off('keypress', cli._handleKeypressBound);
    }
    if (cli._rawModeWasEnabled && input && typeof input.setRawMode === 'function') {
        try {
            input.setRawMode(false);
        } catch {
            // ignore restore issues
        }
    }
    cli._keypressHandlerInitialized = false;
    cli._rawModeWasEnabled = false;
};

export const handleGlobalKeypress = (cli, _, key = {}) => {
    const ctrlC = key?.ctrl && key?.name === 'c';
    if (cli.planInProgress) {
        if (ctrlC) {
            cli.requestCancel('Ctrl+C pressed.');
            return;
        }
        if (key?.name === 'escape') {
            cli.requestCancel('Escape pressed.');
        }
    } else if (ctrlC) {
        restoreInputMode(cli);
        process.exit(0);
    }
};

export const askUser = async (cli, message) => {
    const rl = ensureReadline(cli);
    rl.history = cli.historyEntries.slice().reverse();
    return withRawModePaused(cli, () => new Promise((resolve) => {
        rl.question(message, (answer) => {
            resolve(answer.replace(/\x01/g, '\n'));
        });
    }));
};

export const readMultiline = async (cli, initialPrompt = 'achilles> ', continuationPrompt = '... ') => {
    const lines = [];
    let expectingContinuation = false;

    while (true) {
        // eslint-disable-next-line no-await-in-loop
        const value = await cli.promptReader(expectingContinuation ? continuationPrompt : initialPrompt);
        const trimmed = value.trim();

        if (!expectingContinuation && trimmed.startsWith('/')) {
            recordHistory(cli, trimmed);
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
        recordHistory(cli, finalText);
    }
    return { text: finalText };
};

export const withRawModePaused = async (cli, action) => {
    const input = cli.inputStream;
    const handler = cli._handleKeypressBound;
    const canDetach = Boolean(
        input
        && typeof input.off === 'function'
        && typeof input.on === 'function'
        && handler
        && cli._keypressHandlerInitialized,
    );
    if (!canDetach) {
        return action();
    }
    input.off('keypress', handler);
    try {
        return await action();
    } finally {
        input.on('keypress', handler);
    }
};

export default {
    initHistory,
    recordHistory,
    ensureReadline,
    askUser,
    readMultiline,
    setupGlobalKeypressHandler,
    restoreInputMode,
    withRawModePaused,
    handleGlobalKeypress,
};
