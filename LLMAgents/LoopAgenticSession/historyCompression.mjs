import {
    buildHistoryCompressionPrompt,
    extractJson,
} from './prompts.mjs';

const HISTORY_SUMMARY_TYPE = 'history_summary';
const DEFAULT_HISTORY_COMPRESSION_THRESHOLD_TOKENS = 6000;
const DEFAULT_HISTORY_COMPRESSION_KEEP_RECENT = 8;
const DEFAULT_HISTORY_COMPRESSION_MAX_SUMMARY_TOKENS = 1200;

async function compressHistoryIfNeeded(session, userPrompt) {
    session._ensureNotCancelled();
    if (!session.options.historyCompressionEnabled) {
        return;
    }
    if (session._hasPendingAwaitingInput()) {
        session._debug('[LoopSession]', 'History compression skipped: awaiting input pending');
        return;
    }

    const estimatedTokens = session._estimateHistoryTokens(session.history);
    if (estimatedTokens <= session.options.historyCompressionThresholdTokens) {
        return;
    }

    const keepRecent = session.options.historyCompressionKeepRecentEntries;
    const splitIndex = Math.max(0, session.history.length - keepRecent);
    const historyToCompress = session.history.slice(0, splitIndex);
    const recentHistory = session.history.slice(splitIndex);
    if (!historyToCompress.length) {
        return;
    }

    const refsToCompress = new Set();
    for (const entry of historyToCompress) {
        if (entry.type === 'tool' && entry.resultRef) {
            refsToCompress.add(entry.resultRef);
        }
    }
    const resultRefValues = [];
    for (const ref of refsToCompress) {
        if (session.toolVars.has(ref)) {
            resultRefValues.push({ resultRef: ref, value: session.toolVars.get(ref) });
        }
    }

    const prompt = buildHistoryCompressionPrompt({
        history: historyToCompress,
        resultRefValues,
        userPrompt,
        maxSummaryTokens: session.options.historyCompressionMaxSummaryTokens,
    });

    const raw = await session.agent.complete({
        prompt,
        model: session.options.historyCompressionModel || session.options.model,
        tags: session.options.tags,
        signal: session._currentAbortSignal,
        context: {
            intent: 'agentic-session-history-compression',
            historyEntries: historyToCompress.length,
            estimatedTokens,
        },
    });
    session._ensureNotCancelled();

    let parsed = null;
    try {
        parsed = extractJson(raw);
    } catch {
        parsed = null;
    }

    if (!parsed || typeof parsed !== 'object' || typeof parsed.summary !== 'string' || !parsed.summary.trim()) {
        session._debug('[LoopSession]', 'Compression returned invalid summary; skipping');
        return;
    }

    const summaryText = parsed.summary.trim();
    const keepResultRefs = Array.isArray(parsed.keepResultRefs)
        ? parsed.keepResultRefs.filter((r) => typeof r === 'string' && r.trim()).map((r) => r.trim())
        : [];

    const alwaysKeepRefs = new Set();
    for (const entry of recentHistory) {
        if (entry.type === 'tool' && entry.resultRef) {
            alwaysKeepRefs.add(entry.resultRef);
        }
    }
    for (const ref of keepResultRefs) {
        alwaysKeepRefs.add(ref);
    }

    for (const ref of session.toolVars.keys()) {
        if (!alwaysKeepRefs.has(ref)) {
            session.toolVars.delete(ref);
        }
    }

    session.toolCalls = session.toolCalls.filter((tc) => alwaysKeepRefs.has(tc.resultRef));

    const summaryEntry = {
        type: HISTORY_SUMMARY_TYPE,
        summary: summaryText,
        compressedFromCount: historyToCompress.length,
        compressedAt: new Date().toISOString(),
    };

    session.history = [summaryEntry, ...recentHistory];
    session._debug('[LoopSession]', 'History compressed', {
        previousEntries: historyToCompress.length + recentHistory.length,
        newEntries: session.history.length,
        estimatedTokensBefore: estimatedTokens,
        threshold: session.options.historyCompressionThresholdTokens,
        prunedToolVars: refsToCompress.size - alwaysKeepRefs.size,
        prunedToolCalls: session.toolCalls.length,
    });
}

export {
    DEFAULT_HISTORY_COMPRESSION_THRESHOLD_TOKENS,
    DEFAULT_HISTORY_COMPRESSION_KEEP_RECENT,
    DEFAULT_HISTORY_COMPRESSION_MAX_SUMMARY_TOKENS,
    compressHistoryIfNeeded,
};
