import fs from 'node:fs';
import path from 'node:path';

const BUCKETS = [
    { label: '<100', max: 100 },
    { label: '<1000', max: 1000 },
    { label: '<10000', max: 10_000 },
    { label: '<100000', max: 100_000 },
    { label: '>100000', max: Infinity },
];

const initialBucketStats = () => ({
    requests: 0,
    tokensSent: 0,
    tokensReceived: 0,
    minMs: null,
    maxMs: null,
    totalMs: 0,
});

const ensureDir = (targetPath) => {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
};

const cloneStats = (payload) => JSON.parse(JSON.stringify(payload));

const estimateTokens = (text) => {
    if (!text) {
        return 0;
    }
    return Math.ceil(String(text).length / 4);
};

const bucketForLength = (length) => BUCKETS.find((bucket) => length < bucket.max) || BUCKETS[BUCKETS.length - 1];

let enabled = false;
let logsPath = null;
let statsPath = null;
let stats = {
    totalRequests: 0,
    tokensSent: 0,
    tokensReceived: 0,
    lastModel: null,
    lastUpdated: null,
    models: {},
    buckets: BUCKETS.reduce((acc, bucket) => {
        acc[bucket.label] = initialBucketStats();
        return acc;
    }, {}),
};

const loadStatsFromDisk = () => {
    if (!statsPath || !fs.existsSync(statsPath)) {
        return;
    }
    try {
        const parsed = JSON.parse(fs.readFileSync(statsPath, 'utf8'));
        if (parsed && typeof parsed === 'object') {
            stats = {
                totalRequests: parsed.totalRequests || 0,
                tokensSent: parsed.tokensSent || 0,
                tokensReceived: parsed.tokensReceived || 0,
                lastModel: parsed.lastModel || null,
                lastUpdated: parsed.lastUpdated || null,
                models: parsed.models || {},
                buckets: BUCKETS.reduce((acc, bucket) => {
                    acc[bucket.label] = parsed.buckets?.[bucket.label]
                        || initialBucketStats();
                    return acc;
                }, {}),
            };
        }
    } catch {
        // ignore parse errors, keep defaults
    }
};

const persistStats = () => {
    if (!statsPath) {
        return;
    }
    try {
        ensureDir(statsPath);
        fs.writeFileSync(statsPath, `${JSON.stringify(stats, null, 2)}\n`, 'utf8');
    } catch {
        // ignore write errors
    }
};

export const configureLLMLogger = ({ logsFile = null, statsFile = null } = {}) => {
    logsPath = logsFile || null;
    statsPath = statsFile || null;
    enabled = Boolean(logsPath || statsPath);
    if (!enabled) {
        return;
    }
    if (statsPath) {
        loadStatsFromDisk();
    }
};

const appendLog = (entry) => {
    if (!logsPath) {
        return;
    }
    try {
        ensureDir(logsPath);
        fs.appendFileSync(logsPath, `${JSON.stringify(entry)}\n`, 'utf8');
    } catch {
        // ignore log errors
    }
};

const updateStats = ({ promptLength, tokensSent, tokensReceived, durationMs, model }) => {
    stats.totalRequests += 1;
    stats.tokensSent += tokensSent;
    stats.tokensReceived += tokensReceived;
    stats.lastModel = model;
    stats.lastUpdated = new Date().toISOString();

    const modelKey = model || 'unknown';
    if (!stats.models[modelKey]) {
        stats.models[modelKey] = { requests: 0, tokensSent: 0, tokensReceived: 0 };
    }
    stats.models[modelKey].requests += 1;
    stats.models[modelKey].tokensSent += tokensSent;
    stats.models[modelKey].tokensReceived += tokensReceived;

    const bucket = bucketForLength(promptLength);
    const bucketStats = stats.buckets[bucket.label] || initialBucketStats();
    bucketStats.requests += 1;
    bucketStats.tokensSent += tokensSent;
    bucketStats.tokensReceived += tokensReceived;
    bucketStats.totalMs += durationMs;
    bucketStats.minMs = bucketStats.minMs === null
        ? durationMs
        : Math.min(bucketStats.minMs, durationMs);
    bucketStats.maxMs = bucketStats.maxMs === null
        ? durationMs
        : Math.max(bucketStats.maxMs, durationMs);
    stats.buckets[bucket.label] = bucketStats;

    persistStats();
};

export const logLLMInteraction = ({
    prompt = '',
    response = '',
    model = 'auto',
    mode = 'fast',
    durationMs = 0,
} = {}) => {
    if (!enabled) {
        return;
    }
    const promptText = typeof prompt === 'string' ? prompt : JSON.stringify(prompt);
    const responseText = typeof response === 'string' ? response : JSON.stringify(response);
    const promptLength = promptText.length;
    const tokensSent = estimateTokens(promptText);
    const tokensReceived = estimateTokens(responseText);

    const entry = {
        timestamp: new Date().toISOString(),
        model,
        mode,
        promptLength,
        responseLength: responseText.length,
        tokensSent,
        tokensReceived,
        durationMs,
        promptPreview: promptText.slice(0, 200),
        responsePreview: responseText.slice(0, 200),
    };
    appendLog(entry);
    updateStats({ promptLength, tokensSent, tokensReceived, durationMs, model });
};

export const getLLMStats = () => cloneStats(stats);
