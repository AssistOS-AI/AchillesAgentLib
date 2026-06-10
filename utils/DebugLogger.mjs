import fs from 'node:fs';
import path from 'node:path';

const DEBUG_ENV = String(process.env.ACHILLES_DEBUG ?? '').toLowerCase();
const DEBUG_ENABLED = DEBUG_ENV === 'true' || DEBUG_ENV === '1';

let loggerInstance = null;

function createLogFileStream() {
    const logsDir = path.resolve(process.cwd(), 'debuglogs');
    try {
        fs.mkdirSync(logsDir, { recursive: true });
    } catch (error) {
        console.warn(`[DebugLogger] Failed to create ${logsDir}: ${error.message}`);
        return null;
    }

    const filename = `debug-${process.pid}.log`;
    const fullPath = path.join(logsDir, filename);

    try {
        return fs.createWriteStream(fullPath, { flags: 'a', encoding: 'utf8' });
    } catch (error) {
        console.warn(`[DebugLogger] Failed to open ${fullPath}: ${error.message}`);
        return null;
    }
}

function formatMessage(args) {
    if (!args.length) {
        return '';
    }
    return args.map((entry) => {
        if (entry === null || entry === undefined) {
            return String(entry);
        }
        if (typeof entry === 'object') {
            try {
                return JSON.stringify(entry);
            } catch {
                return String(entry);
            }
        }
        return String(entry);
    }).join(' ');
}

export class DebugLogger {
    constructor(enabled) {
        this.enabled = enabled;
        this.stream = null;
        this.initialised = false;
    }

    ensureStream() {
        if (!this.enabled) {
            return null;
        }
        if (!this.initialised) {
            this.stream = createLogFileStream();
            this.initialised = true;
        }
        return this.stream;
    }

    log(...args) {
        if (!this.enabled) {
            return;
        }
        const stream = this.ensureStream();
        if (!stream) {
            return;
        }
        const timestamp = new Date().toISOString();
        const line = `[${timestamp}] ${formatMessage(args)}\n`;
        stream.write(line);
    }

    debug(...args) {
        this.log('[DEBUG]', ...args);
    }

    info(...args) {
        this.log('[INFO]', ...args);
    }

    warn(...args) {
        this.log('[WARN]', ...args);
    }

    close() {
        if (this.stream) {
            try {
                this.stream.end();
            } catch (error) {
                // ignore shutdown errors
            }
            this.stream = null;
        }
    }
}

export function getDebugLogger() {
    if (!loggerInstance) {
        loggerInstance = new DebugLogger(DEBUG_ENABLED);
    }
    return loggerInstance;
}

export function closeDebugLogger() {
    if (loggerInstance) {
        loggerInstance.close();
    }
}

export const DEBUG_ACTIVE = DEBUG_ENABLED;

export function createLogger({ stream = null } = {}) {
    let fileStream = stream;
    let initialised = false;

    function ensureStream() {
        if (fileStream) return fileStream;
        if (!initialised) {
            fileStream = createLogFileStream();
            initialised = true;
        }
        return fileStream;
    }

    function writeToFile(...args) {
        const stream = ensureStream();
        if (!stream) return;
        const timestamp = new Date().toISOString();
        const line = `[${timestamp}] ${formatMessage(args)}\n`;
        stream.write(line);
    }

    return {
        info(...args) {
            console.info(...args);
        },
        warn(...args) {
            console.warn(...args);
        },
        debug(...args) {
            if (!DEBUG_ENABLED) return;
            console.debug(...args);
            writeToFile(...args);
        },
        close() {
            if (fileStream) {
                try { fileStream.end(); } catch {}
                fileStream = null;
            }
        },
    };
}
