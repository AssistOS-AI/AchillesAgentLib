import crypto from 'node:crypto';

import { canonicalJson, bodyHashForRequest } from './jwtSign.mjs';

export const MAX_TTL_SECONDS = 120;
export const DEFAULT_CLOCK_SKEW_SECONDS = 30;
// Acceptance ends at (exp + skew + 1) s because time validation floors to whole
// seconds; the second extra second absorbs a verifier/cache clock difference.
export const REPLAY_RETENTION_MARGIN_MS = 2000;
// Known issuers mint 22- or 24-character jtis; the bound keeps a signer from
// making each replay-cache entry arbitrarily large.
export const MAX_JTI_LENGTH = 128;
export const JWT_ERROR_CODES = Object.freeze({
    replayCacheExhausted: 'JWT_REPLAY_CACHE_EXHAUSTED',
    replayCacheInvalid: 'JWT_REPLAY_CACHE_INVALID',
    timeOptionsInvalid: 'JWT_TIME_OPTIONS_INVALID'
});

const DEFAULT_REPLAY_CACHE_SIZE = 2048;
const FULL_SWEEP_INTERVAL_MS = 1000;

function jwtError(message, code) {
    const error = new Error(message);
    error.code = code;
    return error;
}

function base64urlDecode(segment) {
    const padding = '==='.slice((segment.length + 3) % 4);
    const base64 = (segment + padding).replace(/-/g, '+').replace(/_/g, '/');
    return Buffer.from(base64, 'base64');
}

function decodeJws(token) {
    if (typeof token !== 'string' || !token) {
        throw new Error('jwtVerify: token must be a non-empty string');
    }
    const parts = token.split('.');
    if (parts.length !== 3) {
        throw new Error('jwtVerify: malformed token');
    }
    const header = JSON.parse(base64urlDecode(parts[0]).toString('utf8'));
    const payload = JSON.parse(base64urlDecode(parts[1]).toString('utf8'));
    const signature = base64urlDecode(parts[2]);
    const signingInput = `${parts[0]}.${parts[1]}`;
    return { header, payload, signature, signingInput };
}

function assertSignatureMatches({ algorithm, signingInput, signature, secret }) {
    if (algorithm !== 'HS256') {
        throw new Error(`jwtVerify: unsupported alg ${algorithm}`);
    }
    const expected = crypto.createHmac('sha256', secret).update(signingInput).digest();
    if (signature.length !== expected.length || !crypto.timingSafeEqual(signature, expected)) {
        throw new Error('jwtVerify: signature invalid');
    }
}

function assertTimeValid(payload, { clockSkewSeconds, maxTtlSeconds, nowMs }) {
    const nowSec = Math.floor(nowMs / 1000);
    const iat = Number(payload.iat);
    const exp = Number(payload.exp);
    if (!Number.isFinite(iat) || !Number.isFinite(exp)) {
        throw new Error('jwtVerify: iat/exp missing or invalid');
    }
    if (exp - iat > maxTtlSeconds) {
        throw new Error(`jwtVerify: token lifetime exceeds max (${exp - iat}s > ${maxTtlSeconds}s)`);
    }
    if (iat > nowSec + clockSkewSeconds) {
        throw new Error('jwtVerify: token used before its issued-at time');
    }
    if (exp + clockSkewSeconds < nowSec) {
        throw new Error('jwtVerify: token expired');
    }
}

function assertAudience(payload, expectedAudience) {
    if (!expectedAudience) return;
    const aud = payload.aud;
    if (Array.isArray(aud)) {
        if (!aud.includes(expectedAudience)) {
            throw new Error(`jwtVerify: audience mismatch (want ${expectedAudience}, got ${aud.join(',')})`);
        }
    } else if (String(aud || '') !== String(expectedAudience)) {
        throw new Error(`jwtVerify: audience mismatch (want ${expectedAudience}, got ${aud})`);
    }
}

function assertBodyHash(payload, bodyObject) {
    if (bodyObject === undefined) return;
    const expected = bodyHashForRequest(bodyObject ?? {});
    const actual = payload.bh ?? payload.body_hash;
    if (actual !== expected) {
        throw new Error('jwtVerify: body hash mismatch');
    }
}

function assertReplayProtected(payload, replayCache, { clockSkewSeconds, nowMs }) {
    // The raw claim is bounded before trimming: a trimmed substring of a padded
    // claim could still keep the whole padded string alive. The bound applies
    // before the opt-out too, so every verified token has a bounded jti.
    const rawJti = String(payload?.jti || '');
    if (rawJti.length > MAX_JTI_LENGTH) {
        throw new Error('jwtVerify: jti too long');
    }
    const jti = rawJti.trim();
    if (!jti) {
        throw new Error('jwtVerify: jti missing');
    }
    // Omitting the cache is the documented opt-out for multi-use tokens.
    if (replayCache === undefined || replayCache === null) return;
    // Keep the jti for the whole interval in which time validation can still
    // accept the token: through exp plus the clock skew, plus the margin.
    const ttlMs = Math.max(
        1,
        (Number(payload.exp) * 1000) + (clockSkewSeconds * 1000) + REPLAY_RETENTION_MARGIN_MS - nowMs
    );
    if (typeof replayCache.consume === 'function') {
        if (replayCache.consume(jti, ttlMs) !== true) {
            throw new Error('jwtVerify: jti has already been consumed');
        }
        return;
    }
    if (typeof replayCache.seen === 'function' && typeof replayCache.remember === 'function') {
        if (replayCache.seen(jti)) {
            throw new Error('jwtVerify: jti has already been consumed');
        }
        replayCache.remember(jti, ttlMs);
        return;
    }
    throw jwtError(
        'jwtVerify: replay cache must implement consume(jti, ttlMs) or seen(jti) and remember(jti, ttlMs)',
        JWT_ERROR_CODES.replayCacheInvalid
    );
}

export function verifyJws(token, {
    secret,
    expectedAudience,
    bodyObject,
    replayCache,
    clockSkewSeconds = DEFAULT_CLOCK_SKEW_SECONDS,
    maxTtlSeconds = MAX_TTL_SECONDS,
    now
} = {}) {
    if (!secret || !Buffer.isBuffer(secret)) {
        throw new Error('jwtVerify: secret (Buffer) required');
    }
    // One clock reading serves both time validation and replay retention.
    const nowMs = Number(now ?? Date.now());
    if (!Number.isFinite(nowMs)) {
        throw jwtError('jwtVerify: now must be a finite time in milliseconds', JWT_ERROR_CODES.timeOptionsInvalid);
    }
    if (!Number.isFinite(clockSkewSeconds) || clockSkewSeconds < 0) {
        throw jwtError('jwtVerify: clockSkewSeconds must be a finite number >= 0', JWT_ERROR_CODES.timeOptionsInvalid);
    }
    const { header, payload, signature, signingInput } = decodeJws(token);
    assertSignatureMatches({
        algorithm: header.alg,
        signingInput,
        signature,
        secret
    });
    assertTimeValid(payload, { clockSkewSeconds, maxTtlSeconds, nowMs });
    assertAudience(payload, expectedAudience);
    assertBodyHash(payload, bodyObject);
    // The replay check stays last, so only a validly signed, current token can
    // observe a consumed, exhausted, or quota status.
    assertReplayProtected(payload, replayCache, { clockSkewSeconds, nowMs });
    return { header, payload };
}

export function verifyInvocationToken(token, {
    secret,
    expectedAudience,
    expectedIssuer = 'ploinky-router',
    expectedTool,
    bodyObject,
    replayCache,
    clockSkewSeconds,
    maxTtlSeconds,
    now
}) {
    const result = verifyJws(token, {
        secret,
        expectedAudience,
        bodyObject,
        replayCache,
        clockSkewSeconds,
        maxTtlSeconds,
        now
    });
    if (result.payload?.typ !== 'invocation') {
        throw new Error('jwtVerify: token type is not invocation');
    }
    if (expectedIssuer && result.payload?.iss !== expectedIssuer) {
        throw new Error(`jwtVerify: issuer mismatch (want ${expectedIssuer}, got ${result.payload?.iss})`);
    }
    if (expectedTool && String(result.payload?.tool || '') !== String(expectedTool)) {
        throw new Error(`jwtVerify: tool mismatch (want ${expectedTool}, got ${result.payload?.tool})`);
    }
    return result;
}

/**
 * Fail-closed, single-process replay cache. Entries live while their expiry is
 * after now(); a full cache refuses a new jti instead of forgetting a live one.
 * Map insertion order follows the last record, so each call drops the expired
 * prefix in O(1) amortized time, and one full sweep (at most once per second)
 * runs before a capacity refusal to reclaim out-of-order expired entries.
 */
export function createMemoryReplayCache({ maxSize = DEFAULT_REPLAY_CACHE_SIZE, now = () => Date.now() } = {}) {
    if (typeof now !== 'function') {
        throw jwtError('jwtVerify: replay cache now must be a function', JWT_ERROR_CODES.timeOptionsInvalid);
    }
    const capacity = Number.isSafeInteger(Number(maxSize)) && Number(maxSize) > 0
        ? Number(maxSize)
        : DEFAULT_REPLAY_CACHE_SIZE;
    const entries = new Map();
    let lastFullSweepAt = -Infinity;

    function sweepExpiredPrefix(currentTime) {
        for (const [jti, expiresAt] of entries) {
            if (expiresAt > currentTime) break;
            entries.delete(jti);
        }
    }

    function sweepAllExpired(currentTime) {
        if (currentTime - lastFullSweepAt < FULL_SWEEP_INTERVAL_MS) return;
        lastFullSweepAt = currentTime;
        for (const [jti, expiresAt] of entries) {
            if (expiresAt <= currentTime) entries.delete(jti);
        }
    }

    function isLive(jti, currentTime) {
        const expiresAt = entries.get(jti);
        return expiresAt !== undefined && expiresAt > currentTime;
    }

    function record(jti, ttlMs, currentTime) {
        const live = isLive(jti, currentTime);
        if (!live) {
            entries.delete(jti);
            if (entries.size >= capacity) {
                sweepAllExpired(currentTime);
                if (entries.size >= capacity) {
                    throw jwtError('jwtVerify: replay cache capacity exhausted', JWT_ERROR_CODES.replayCacheExhausted);
                }
            }
        }
        const requested = currentTime + Math.max(1, Number(ttlMs) || 1);
        const expiresAt = live ? Math.max(entries.get(jti), requested) : requested;
        entries.delete(jti);
        entries.set(jti, expiresAt);
    }

    // Refuses a key the cache must not store, before any entry is read or removed.
    function assertKey(jti) {
        if (typeof jti !== 'string' || jti.length > MAX_JTI_LENGTH) {
            throw new Error(`jwtVerify: replay cache key must be a string of at most ${MAX_JTI_LENGTH} characters`);
        }
    }

    // Entries are keyed by a fixed-size digest, never by the caller's string,
    // which may be a slice that keeps a much larger decoded payload alive.
    function entryKey(jti) {
        assertKey(jti);
        return crypto.createHash('sha256').update(jti, 'utf8').digest('base64url');
    }

    // A non-finite clock would make every entry look expired and admit replays,
    // so it is refused before any entry is read or removed.
    function startCall() {
        const currentTime = Number(now());
        if (!Number.isFinite(currentTime)) {
            throw jwtError(
                'jwtVerify: replay cache clock returned a non-finite time',
                JWT_ERROR_CODES.timeOptionsInvalid
            );
        }
        sweepExpiredPrefix(currentTime);
        return currentTime;
    }

    return {
        consume(jti, ttlMs) {
            const key = entryKey(jti);
            const currentTime = startCall();
            // A live jti reports "consumed" before any capacity decision.
            if (isLive(key, currentTime)) return false;
            record(key, ttlMs, currentTime);
            return true;
        },
        seen(jti) {
            const key = entryKey(jti);
            return isLive(key, startCall());
        },
        remember(jti, ttlMs) {
            const key = entryKey(jti);
            record(key, ttlMs, startCall());
        },
        reset() {
            entries.clear();
            lastFullSweepAt = -Infinity;
        },
        size() {
            const currentTime = startCall();
            let live = 0;
            for (const expiresAt of entries.values()) {
                if (expiresAt > currentTime) live += 1;
            }
            return live;
        }
    };
}

export { canonicalJson, bodyHashForRequest };
