import {
    STATUS_SUCCESS,
    STATUS_FAIL,
    STATUS_UNDEFINED,
    STATUS_CANCELED,
    normalizeStatus,
} from './constants.mjs';

function normalizeCancelReason(reason) {
    if (reason == null) {
        return 'no reason provided';
    }
    const text = String(reason).trim();
    return text || 'no reason provided';
}

function formatCommandLabel(rootCause, fallback) {
    if (rootCause && rootCause.command) {
        return rootCause.command;
    }
    return fallback;
}

let lastTimestamp = 0;

export function generateTimestamp() {
    const now = Date.now();
    if (now <= lastTimestamp) {
        lastTimestamp += 1;
        return lastTimestamp;
    }
    lastTimestamp = now;
    return lastTimestamp;
}

export function ensureTimestamp(value = generateTimestamp()) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        throw new Error(`Invalid timestamp value: ${value}`);
    }
    return Math.trunc(numeric);
}

export function buildRawValue(timestamp, status, data = '') {
    const safeTimestamp = ensureTimestamp(timestamp);
    const payload = data ?? '';
    return `${safeTimestamp}:${status}:${payload}`;
}

export function createValue({
    status,
    timestamp = null,
    data = '',
    raw = null,
    rootCause = null,
    via = null,
    origin = 'internal',
} = {}) {
    if (!status) {
        throw new Error('Value status is required');
    }
    const normalized = normalizeStatus(status);
    if (!normalized) {
        throw new Error(`Unsupported status: ${status}`);
    }
    const safeTimestamp = timestamp == null ? generateTimestamp() : ensureTimestamp(timestamp);
    const payload = data ?? '';
    const computedRaw = raw ?? buildRawValue(safeTimestamp, normalized, payload);
    return {
        status: normalized,
        timestamp: safeTimestamp,
        data: payload,
        raw: computedRaw,
        rootCause: normalized === STATUS_CANCELED ? rootCause : null,
        via,
        origin,
    };
}

export function createSuccessValue(data = '', origin = 'command') {
    return createValue({
        status: STATUS_SUCCESS,
        data,
        origin,
    });
}

export function createUndefinedValue(reason = '', origin = 'internal') {
    return createValue({
        status: STATUS_UNDEFINED,
        data: reason,
        origin,
    });
}

export function createFailValue(reason, origin = 'internal') {
    const message = reason ?? '';
    return createValue({
        status: STATUS_FAIL,
        data: message,
        origin,
    });
}

export function createRootCanceledValue(variableName, reason, origin = 'command', metadata = {}) {
    const payload = normalizeCancelReason(reason);
    const commandLabel = metadata.command ?? variableName;
    const message = `command ${commandLabel} canceled (${payload})`;
    return createValue({
        status: STATUS_CANCELED,
        data: message,
        origin,
        rootCause: {
            name: variableName,
            reason: payload,
            command: metadata.command ?? null,
            heuristic: metadata.heuristic ?? null,
            source: metadata.source ?? origin,
        },
    });
}

export function createPropagatedCanceledValue(rootCause, via) {
    if (!rootCause || !rootCause.name) {
        throw new Error('Root cause must include a name');
    }
    const reasonText = normalizeCancelReason(rootCause.reason);
    const label = formatCommandLabel(rootCause, rootCause.name);
    const viaText = via ? ` via ${via}` : '';
    const message = `because command ${label} canceled (${reasonText})${viaText}`;
    return createValue({
        status: STATUS_CANCELED,
        data: message,
        origin: 'propagation',
        rootCause,
        via,
    });
}

export function formatPublicValue(value) {
    if (!value) {
        return undefined;
    }
    const data = value.data ?? '';
    switch (value.status) {
        case STATUS_SUCCESS:
            return data;
        case STATUS_UNDEFINED:
            return data ? `${STATUS_UNDEFINED}:${data}` : STATUS_UNDEFINED;
        case STATUS_FAIL:
            return `${STATUS_FAIL}:${data}`;
        case STATUS_CANCELED:
            return `${STATUS_CANCELED}:${data}`;
        default:
            return data;
    }
}

export function valueToCommandArgument(value) {
    return formatPublicValue(value);
}

export function cloneValueWith(value, overrides = {}) {
    return createValue({
        status: overrides.status ?? value.status,
        timestamp: overrides.timestamp ?? value.timestamp,
        data: overrides.data ?? value.data,
        raw: overrides.raw ?? null,
        rootCause: overrides.rootCause ?? value.rootCause,
        via: overrides.via ?? value.via,
        origin: overrides.origin ?? value.origin,
    });
}
