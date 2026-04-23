import crypto from 'node:crypto';

import { canonicalJson, bodyHashForRequest } from './jwtSign.mjs';

export const MAX_TTL_SECONDS = 120;
export const DEFAULT_CLOCK_SKEW_SECONDS = 30;

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

function assertTimeValid(payload, { clockSkewSeconds = DEFAULT_CLOCK_SKEW_SECONDS, maxTtlSeconds = MAX_TTL_SECONDS, now }) {
    const nowSec = Math.floor((now ?? Date.now()) / 1000);
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

function assertReplayProtected(payload, replayCache) {
    const jti = String(payload?.jti || '').trim();
    if (!jti) {
        throw new Error('jwtVerify: jti missing');
    }
    if (!replayCache) return;
    if (typeof replayCache.seen === 'function') {
        if (replayCache.seen(jti)) {
            throw new Error('jwtVerify: jti has already been consumed');
        }
        if (typeof replayCache.remember === 'function') {
            const ttlMs = Math.max(1, (Number(payload.exp) * 1000) - Date.now()) + 1000;
            replayCache.remember(jti, ttlMs);
        }
    }
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
    const { header, payload, signature, signingInput } = decodeJws(token);
    assertSignatureMatches({
        algorithm: header.alg,
        signingInput,
        signature,
        secret
    });
    assertTimeValid(payload, { clockSkewSeconds, maxTtlSeconds, now });
    assertAudience(payload, expectedAudience);
    assertBodyHash(payload, bodyObject);
    assertReplayProtected(payload, replayCache);
    return { header, payload };
}

export function verifyInvocationToken(token, {
    secret,
    expectedAudience,
    bodyObject,
    replayCache,
    clockSkewSeconds,
    maxTtlSeconds
}) {
    return verifyJws(token, {
        secret,
        expectedAudience,
        bodyObject,
        replayCache,
        clockSkewSeconds,
        maxTtlSeconds
    });
}

export function createMemoryReplayCache({ maxSize = 2048 } = {}) {
    const entries = new Map();
    function prune() {
        const now = Date.now();
        for (const [jti, expiresAt] of entries) {
            if (expiresAt <= now) entries.delete(jti);
        }
        while (entries.size > maxSize) {
            const firstKey = entries.keys().next().value;
            if (firstKey === undefined) break;
            entries.delete(firstKey);
        }
    }
    return {
        seen(jti) {
            prune();
            return entries.has(jti);
        },
        remember(jti, ttlMs) {
            prune();
            entries.set(jti, Date.now() + Math.max(1, Number(ttlMs) || 1));
        },
        reset() { entries.clear(); }
    };
}

export { canonicalJson, bodyHashForRequest };
