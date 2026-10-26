import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import { signHmacJwt } from '../../jwt/jwtSign.mjs';
import {
    JWT_ERROR_CODES,
    MAX_JTI_LENGTH,
    REPLAY_RETENTION_MARGIN_MS,
    createMemoryReplayCache,
    verifyInvocationToken,
    verifyJws,
} from '../../jwt/jwtVerify.mjs';
import * as jwtIndex from '../../jwt/index.mjs';

const SECRET = crypto.randomBytes(32);
const AUDIENCE = 'replay-contract-test';
// A past issue time: any accidental use of the wall clock instead of the `now`
// option makes these tokens expired or gives them a 1 ms retention.
const ISSUED_AT = 1_000_000_000;
const ISSUED_AT_MS = ISSUED_AT * 1000;

function signToken({ iat = ISSUED_AT, ttlSeconds = 30, jti = crypto.randomUUID(), extra = {} } = {}) {
    const payload = { iss: 'replay-contract-test', aud: AUDIENCE, iat, exp: iat + ttlSeconds, ...extra };
    if (jti !== null) payload.jti = jti;
    return signHmacJwt({ payload, secret: SECRET });
}

function verifyAt(token, nowMs, options = {}) {
    return verifyJws(token, { secret: SECRET, expectedAudience: AUDIENCE, now: nowMs, ...options });
}

function manualClock(start = 0) {
    const clock = { value: start, now: () => clock.value };
    return clock;
}

test('consume records once and reports a second consume as already present', () => {
    const cache = createMemoryReplayCache({ maxSize: 4 });
    assert.equal(cache.consume('jti-a', 1000), true);
    assert.equal(cache.consume('jti-a', 1000), false);
    assert.equal(cache.seen('jti-a'), true);
    assert.equal(cache.size(), 1);
});

test('consume at capacity throws JWT_REPLAY_CACHE_EXHAUSTED and records nothing', () => {
    const cache = createMemoryReplayCache({ maxSize: 1 });
    assert.equal(cache.consume('jti-a', 60_000), true);
    assert.throws(() => cache.consume('jti-b', 60_000), {
        code: 'JWT_REPLAY_CACHE_EXHAUSTED',
        message: /replay cache capacity exhausted/,
    });
    assert.equal(cache.seen('jti-b'), false);
    assert.equal(cache.seen('jti-a'), true);
    assert.equal(cache.size(), 1);
    assert.throws(() => cache.remember('jti-b', 60_000), { code: 'JWT_REPLAY_CACHE_EXHAUSTED' });
    assert.equal(cache.consume('jti-a', 60_000), false);
});

test('an injected now clock controls cache expiry without mocking Date', () => {
    const clock = manualClock(10_000);
    const cache = createMemoryReplayCache({ maxSize: 1, now: clock.now });
    assert.equal(cache.consume('jti-a', 500), true);
    clock.value = 10_499;
    assert.equal(cache.seen('jti-a'), true);
    assert.equal(cache.consume('jti-a', 500), false);
    clock.value = 10_500;
    assert.equal(cache.seen('jti-a'), false);
    assert.equal(cache.consume('jti-b', 500), true);
});

test('verifyJws retention follows the now option', () => {
    const clock = manualClock(ISSUED_AT_MS);
    const cache = createMemoryReplayCache({ now: clock.now });
    const token = signToken();
    verifyAt(token, ISSUED_AT_MS, { replayCache: cache });
    clock.value = ISSUED_AT_MS + 35_000;
    assert.throws(() => verifyAt(token, ISSUED_AT_MS + 35_000, { replayCache: cache }), /already been consumed/);
});

test('verifyInvocationToken forwards now', () => {
    const token = signToken({ extra: { typ: 'invocation', iss: 'ploinky-router' } });
    assert.throws(
        () => verifyInvocationToken(token, { secret: SECRET, expectedAudience: AUDIENCE }),
        /token expired/,
    );
    const { payload } = verifyInvocationToken(token, {
        secret: SECRET,
        expectedAudience: AUDIENCE,
        now: ISSUED_AT_MS + 1000,
    });
    assert.equal(payload.typ, 'invocation');
});

test('a seen/remember cache receives a ttl covering exp plus skew plus margin', () => {
    const calls = [];
    const cache = {
        seen(jti) { calls.push(['seen', jti]); return false; },
        remember(jti, ttlMs) { calls.push(['remember', jti, ttlMs]); },
    };
    const nowMs = ISSUED_AT_MS + 1234;
    const token = signToken({ jti: 'spy-jti' });
    verifyAt(token, nowMs, { replayCache: cache });
    const exp = ISSUED_AT + 30;
    assert.equal(REPLAY_RETENTION_MARGIN_MS, 2000);
    assert.deepEqual(calls, [
        ['seen', 'spy-jti'],
        ['remember', 'spy-jti', (exp * 1000) + 30_000 + 2000 - nowMs],
    ]);
});

test('a replay cache without consume or both seen and remember is refused', () => {
    const invalidCaches = [{}, { seen: () => false }, { remember: () => {} }, 'x'];
    for (const replayCache of invalidCaches) {
        assert.throws(
            () => verifyAt(signToken(), ISSUED_AT_MS, { replayCache }),
            { code: JWT_ERROR_CODES.replayCacheInvalid, message: /replay cache must implement/ },
        );
    }
});

test('omitting the replay cache skips replay protection but still requires a jti', () => {
    const token = signToken();
    verifyAt(token, ISSUED_AT_MS);
    verifyAt(token, ISSUED_AT_MS, { replayCache: null });
    verifyAt(token, ISSUED_AT_MS, { replayCache: undefined });
    assert.throws(() => verifyAt(signToken({ jti: null }), ISSUED_AT_MS), /jti missing/);
});

test('invalid clock skew or now is refused', () => {
    const token = signToken();
    const invalidOptions = [{ clockSkewSeconds: Number.NaN }, { clockSkewSeconds: -1 }, { now: 'x' }];
    for (const options of invalidOptions) {
        assert.throws(
            () => verifyJws(token, { secret: SECRET, expectedAudience: AUDIENCE, now: ISSUED_AT_MS, ...options }),
            { code: JWT_ERROR_CODES.timeOptionsInvalid },
        );
    }
});

test('consume is preferred over seen and remember', () => {
    const calls = [];
    const cache = {
        consume(jti, ttlMs) { calls.push(['consume', jti, ttlMs]); return true; },
        seen() { calls.push(['seen']); return false; },
        remember() { calls.push(['remember']); },
    };
    const nowMs = ISSUED_AT_MS;
    verifyAt(signToken({ jti: 'consume-jti' }), nowMs, { replayCache: cache });
    assert.deepEqual(calls, [['consume', 'consume-jti', ((ISSUED_AT + 30) * 1000) + 32_000 - nowMs]]);
    cache.consume = (jti, ttlMs) => { calls.push(['consume', jti, ttlMs]); return false; };
    assert.throws(() => verifyAt(signToken(), nowMs, { replayCache: cache }), /already been consumed/);
    assert.equal(calls.some(([name]) => name !== 'consume'), false);
});

test('out-of-order expired entries are reclaimed before a capacity refusal', () => {
    const clock = manualClock(0);
    const cache = createMemoryReplayCache({ maxSize: 2, now: clock.now });
    assert.equal(cache.consume('long-lived', 10_000), true);
    assert.equal(cache.consume('short-lived', 100), true);
    clock.value = 200;
    assert.equal(cache.consume('new-entry', 100), true);
    assert.equal(cache.seen('long-lived'), true);
    assert.equal(cache.seen('short-lived'), false);
    assert.throws(() => cache.consume('another-entry', 100), { code: 'JWT_REPLAY_CACHE_EXHAUSTED' });
});

test('the jwt index re-exports the new constants', () => {
    assert.equal(jwtIndex.REPLAY_RETENTION_MARGIN_MS, 2000);
    assert.deepEqual({ ...jwtIndex.JWT_ERROR_CODES }, {
        replayCacheExhausted: 'JWT_REPLAY_CACHE_EXHAUSTED',
        replayCacheInvalid: 'JWT_REPLAY_CACHE_INVALID',
        timeOptionsInvalid: 'JWT_TIME_OPTIONS_INVALID',
    });
    assert.equal(Object.isFrozen(jwtIndex.JWT_ERROR_CODES), true);
    assert.equal(jwtIndex.createMemoryReplayCache, createMemoryReplayCache);
});

test('an invalid maxSize falls back to 2048', () => {
    for (const maxSize of [0, -1, Number.NaN, 2 ** 53, 'many']) {
        const cache = createMemoryReplayCache({ maxSize });
        for (let index = 0; index < 2048; index += 1) {
            assert.equal(cache.consume(`jti-${index}`, 60_000), true);
        }
        assert.throws(() => cache.consume('jti-overflow', 60_000), { code: 'JWT_REPLAY_CACHE_EXHAUSTED' });
    }
});

test('a non-finite replay cache clock is refused and never admits a jti', () => {
    const clocks = {
        NaN: () => Number.NaN,
        Infinity: () => Number.POSITIVE_INFINITY,
        '-Infinity': () => Number.NEGATIVE_INFINITY,
        undefined: () => undefined,
        'Date called as a function': Date,
    };
    for (const [label, clock] of Object.entries(clocks)) {
        const cache = createMemoryReplayCache({ now: clock });
        const refused = { code: JWT_ERROR_CODES.timeOptionsInvalid, message: /non-finite time/ };
        assert.throws(() => cache.consume('jti', 60_000), refused, `${label}: consume`);
        assert.throws(() => cache.seen('jti'), refused, `${label}: seen`);
        assert.throws(() => cache.remember('jti', 60_000), refused, `${label}: remember`);
        assert.throws(
            () => verifyAt(signToken(), ISSUED_AT_MS, { replayCache: cache }),
            refused,
            `${label}: verifyJws`,
        );
    }

    // A transient bad reading must not sweep away live entries recorded before it.
    const reading = { value: 10_000 };
    const cache = createMemoryReplayCache({ now: () => reading.value });
    assert.equal(cache.consume('live-jti', 60_000), true);
    reading.value = Number.NaN;
    assert.throws(() => cache.consume('live-jti', 60_000), { code: JWT_ERROR_CODES.timeOptionsInvalid });
    reading.value = Number.POSITIVE_INFINITY;
    assert.throws(() => cache.consume('other-jti', 60_000), { code: JWT_ERROR_CODES.timeOptionsInvalid });
    reading.value = 10_001;
    assert.equal(cache.consume('live-jti', 60_000), false);
    assert.equal(cache.size(), 1);
});

test('a replay cache clock that is not a function is refused at construction', () => {
    for (const now of ['x', 5, null, {}]) {
        assert.throws(
            () => createMemoryReplayCache({ now }),
            { code: JWT_ERROR_CODES.timeOptionsInvalid, message: /now must be a function/ },
        );
    }
});

test('verifyJws accepts a jti of MAX_JTI_LENGTH characters and refuses a longer one before the cache', () => {
    assert.equal(MAX_JTI_LENGTH, 128);
    assert.equal(jwtIndex.MAX_JTI_LENGTH, 128);
    const calls = [];
    const memory = createMemoryReplayCache();
    const spy = {
        consume(jti, ttlMs) {
            calls.push(jti);
            return memory.consume(jti, ttlMs);
        },
    };
    const atLimit = 'a'.repeat(MAX_JTI_LENGTH);
    const { payload } = verifyAt(signToken({ jti: atLimit }), ISSUED_AT_MS, { replayCache: spy });
    assert.equal(payload.jti, atLimit);
    assert.deepEqual(calls, [atLimit]);

    // The token is validly signed and current, so only the jti bound refuses it.
    const overLimit = signToken({ jti: 'b'.repeat(MAX_JTI_LENGTH + 1) });
    assert.throws(() => verifyAt(overLimit, ISSUED_AT_MS, { replayCache: spy }), /^Error: jwtVerify: jti too long$/);
    assert.throws(() => verifyAt(overLimit, ISSUED_AT_MS), /jwtVerify: jti too long/);
    assert.deepEqual(calls, [atLimit]);
    assert.equal(memory.size(), 1);
});

test('the memory replay cache refuses a non-string or over-long key and records nothing', () => {
    const cache = createMemoryReplayCache();
    const invalidKeys = ['c'.repeat(MAX_JTI_LENGTH + 1), 42, undefined, null, { toString: () => 'x' }];
    for (const key of invalidKeys) {
        assert.throws(() => cache.consume(key, 60_000), /jwtVerify: replay cache key must be a string/);
        assert.throws(() => cache.seen(key), /jwtVerify: replay cache key must be a string/);
        assert.throws(() => cache.remember(key, 60_000), /jwtVerify: replay cache key must be a string/);
    }
    assert.equal(cache.size(), 0);
    assert.equal(cache.consume('d'.repeat(MAX_JTI_LENGTH), 60_000), true);
    assert.equal(cache.seen('d'.repeat(MAX_JTI_LENGTH)), true);
    assert.equal(cache.size(), 1);
});

test('a padded jti whose trimmed value fits is refused by its raw length before the cache', () => {
    const calls = [];
    const spy = {
        consume(jti) {
            calls.push(jti);
            return true;
        },
    };
    // Validly signed and current; only the raw jti length can refuse it.
    const padded = signToken({ jti: `${'a'.repeat(MAX_JTI_LENGTH)}${' '.repeat(11_000)}` });
    assert.throws(() => verifyAt(padded, ISSUED_AT_MS, { replayCache: spy }), /^Error: jwtVerify: jti too long$/);
    assert.throws(() => verifyAt(padded, ISSUED_AT_MS), /^Error: jwtVerify: jti too long$/);
    assert.deepEqual(calls, []);
    // A short padded jti still verifies, and the cache receives the trimmed value.
    verifyAt(signToken({ jti: '  short-jti  ' }), ISSUED_AT_MS, { replayCache: spy });
    assert.deepEqual(calls, ['short-jti']);
});

test('digest keys keep consume, replay, capacity and size behaviour', () => {
    const clock = manualClock(0);
    const cache = createMemoryReplayCache({ maxSize: 3, now: clock.now });
    const keys = ['a', 'b'.repeat(MAX_JTI_LENGTH), 'é-ü'];
    for (const key of keys) assert.equal(cache.consume(key, 1000), true);
    for (const key of keys) {
        assert.equal(cache.seen(key), true);
        assert.equal(cache.consume(key, 1000), false);
    }
    assert.equal(cache.seen('a '), false, 'distinct strings stay distinct keys');
    assert.equal(cache.size(), 3);
    assert.throws(() => cache.consume('d', 1000), { code: 'JWT_REPLAY_CACHE_EXHAUSTED' });
    cache.remember('a', 5000);
    clock.value = 1000;
    assert.equal(cache.seen('a'), true, 'remember extends the same entry as consume');
    assert.equal(cache.size(), 1);
    assert.equal(cache.consume('d', 1000), true);
    assert.equal(cache.size(), 2);
});
