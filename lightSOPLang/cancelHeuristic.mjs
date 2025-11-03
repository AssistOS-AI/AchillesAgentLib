const STRING_PATTERNS = [
    /^cancel(?:led|ation)?\b/i,
    /^cancled\b/i,
    /^cancel:\s*/i,
    /^stop\b/i,
    /^abort\b/i,
    /^halt\b/i,
];

const STATUS_KEYWORDS = new Set([
    'cancel',
    'canceled',
    'cancelled',
    'cancled',
    'cancelation',
]);

function extractReasonFromString(raw) {
    const text = String(raw ?? '').trim();
    if (!text) {
        return { match: false };
    }
    const lower = text.toLowerCase();

    for (const pattern of STRING_PATTERNS) {
        if (pattern.test(lower)) {
            const cleaned = text.replace(/^cancel(?:led|ation|ed)?[:\s-]*/i, '').trim();
            return {
                match: true,
                reason: cleaned || text,
                source: 'string-prefix',
            };
        }
    }

    if (lower.includes('cancelled') || lower.includes('canceled') || lower.includes('cancelled')) {
        return {
            match: true,
            reason: text,
            source: 'string-contains',
        };
    }

    return { match: false };
}

function extractReasonFromObject(value) {
    if (!value || typeof value !== 'object') {
        return { match: false };
    }

    const status = value.status ?? value.state ?? value.result;
    if (status != null) {
        const normalized = String(status).trim().toLowerCase();
        if (STATUS_KEYWORDS.has(normalized)) {
            const reasonCandidate = value.reason ?? value.message ?? value.detail ?? '';
            return {
                match: true,
                reason: reasonCandidate ? String(reasonCandidate) : normalized,
                source: 'object-status',
            };
        }
    }

    if (value.cancel === true || value.cancelled === true || value.canceled === true) {
        const reasonCandidate = value.reason ?? value.message ?? '';
        return {
            match: true,
            reason: reasonCandidate ? String(reasonCandidate) : 'canceled',
            source: 'object-flag',
        };
    }

    return { match: false };
}

export function cancelEuristic(output) {
    if (output == null) {
        return null;
    }

    if (typeof output === 'string') {
        const { match, reason, source } = extractReasonFromString(output);
        if (match) {
            return {
                reason,
                source,
                raw: output,
            };
        }
        return null;
    }

    if (typeof output === 'object') {
        const { match, reason, source } = extractReasonFromObject(output);
        if (match) {
            return {
                reason,
                source,
                raw: output,
            };
        }
        if (typeof output.toString === 'function' && output !== output.toString()) {
            return cancelEuristic(output.toString());
        }
        return null;
    }

    return cancelEuristic(String(output));
}

export default cancelEuristic;
