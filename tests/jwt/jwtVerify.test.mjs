import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import { signHmacJwt } from '../../jwt/jwtSign.mjs';
import { createMemoryReplayCache, verifyJws } from '../../jwt/jwtVerify.mjs';

// This file imports only names that exist in every published jwtVerify.mjs, so
// the same bytes prove the refusals fail before the change and pass after it.
const SECRET = crypto.randomBytes(32);
const AUDIENCE = 'jwt-verify-test';
const T0 = 1_800_000_000_000;
const T0_SECONDS = T0 / 1000;
const TTL_SECONDS = 30;
const SKEW_SECONDS = 30;

function signToken({ iat = T0_SECONDS, ttlSeconds = TTL_SECONDS } = {}) {
    const jti = crypto.randomBytes(16).toString('base64url');
    return signHmacJwt({
        payload: { iss: 'jwt-verify-test', aud: AUDIENCE, iat, exp: iat + ttlSeconds, jti },
        secret: SECRET,
    });
}

function verify(token, replayCache) {
    return verifyJws(token, { secret: SECRET, expectedAudience: AUDIENCE, replayCache });
}

function useMockedClock(t) {
    t.mock.timers.enable({ apis: ['Date'], now: T0 });
}

test('replay 5 s after exp is refused', (t) => {
    useMockedClock(t);
    const cache = createMemoryReplayCache();
    const token = signToken();
    verify(token, cache);
    t.mock.timers.tick((TTL_SECONDS + 5) * 1000);
    assert.throws(() => verify(token, cache), /already been consumed/);
});

test('replay at the last accepted millisecond of the skew window is refused', (t) => {
    useMockedClock(t);
    const cache = createMemoryReplayCache();
    const token = signToken();
    verify(token, cache);
    t.mock.timers.tick(((TTL_SECONDS + SKEW_SECONDS) * 1000) + 999);
    assert.throws(() => verify(token, cache), /already been consumed/);
});

test('the token is refused as expired once the skew window has passed', (t) => {
    useMockedClock(t);
    const cache = createMemoryReplayCache();
    const token = signToken();
    verify(token, cache);
    t.mock.timers.tick((TTL_SECONDS + SKEW_SECONDS + 1) * 1000);
    assert.throws(() => verify(token, cache), /token expired/);
});

test('a full cache throws instead of admitting a new jti', (t) => {
    useMockedClock(t);
    const cache = createMemoryReplayCache({ maxSize: 2 });
    verify(signToken(), cache);
    verify(signToken(), cache);
    assert.throws(() => verify(signToken(), cache), {
        code: 'JWT_REPLAY_CACHE_EXHAUSTED',
        message: /replay cache capacity exhausted/,
    });
});

test('a live jti is still refused after an attempt to overflow the cache', (t) => {
    useMockedClock(t);
    const cache = createMemoryReplayCache({ maxSize: 2 });
    const first = signToken();
    verify(first, cache);
    verify(signToken(), cache);
    try {
        verify(signToken(), cache);
    } catch (_) {
        // The overflow attempt may be refused; the live jti must survive either way.
    }
    assert.throws(() => verify(first, cache), /already been consumed/);
});

test('expired entries are reclaimed so a full cache admits new tokens after retention', (t) => {
    useMockedClock(t);
    const cache = createMemoryReplayCache({ maxSize: 2 });
    verify(signToken(), cache);
    verify(signToken(), cache);
    t.mock.timers.tick(63_000);
    const fresh = signToken({ iat: T0_SECONDS + 63 });
    const { payload } = verify(fresh, cache);
    assert.equal(payload.iat, T0_SECONDS + 63);
});

test('an immediate replay is refused', (t) => {
    useMockedClock(t);
    const cache = createMemoryReplayCache();
    const token = signToken();
    verify(token, cache);
    assert.throws(() => verify(token, cache), /already been consumed/);
});
