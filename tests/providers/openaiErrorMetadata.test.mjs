import { test } from 'node:test';
import assert from 'node:assert/strict';

import { callLLM, callLLMStreaming } from '../../utils/LLMProviders/providers/openai.mjs';

const HISTORY = [{ role: 'user', message: 'Hello' }];
const OPTIONS = { model: 'm', apiKey: 'k', baseURL: 'https://openrouter.ai/api/v1' };

function withFetch(impl, run) {
    const original = globalThis.fetch;
    globalThis.fetch = impl;
    return Promise.resolve().then(run).finally(() => {
        globalThis.fetch = original;
    });
}

function errorResponse(status, body, headers = {}) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json', ...headers },
    });
}

function sseResponse(frames) {
    const text = frames.map((frame) => `data: ${typeof frame === 'string' ? frame : JSON.stringify(frame)}\n\n`).join('');
    return new Response(text, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

async function drain(generator) {
    const events = [];
    for await (const event of generator) events.push(event);
    return events;
}

test('streaming HTTP errors carry status, parsed body, and rate-limit headers', async () => {
    const body = { error: { code: 429, message: 'Rate limit exceeded: free-models-per-day.' } };
    await withFetch(async () => errorResponse(429, body, {
        'Retry-After': '30',
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': '1790000000000',
        'Set-Cookie': 'ignored=1',
    }), async () => {
        await assert.rejects(drain(callLLMStreaming(HISTORY, OPTIONS)), (err) => {
            assert.equal(err.status, 429);
            assert.deepEqual(err.body, body);
            assert.deepEqual(err.headers, {
                'retry-after': '30',
                'x-ratelimit-remaining': '0',
                'x-ratelimit-reset': '1790000000000',
            });
            assert.match(err.message, /API request failed: 429/);
            return true;
        });
    });
});

test('buffered HTTP errors carry status and keep non-JSON bodies bounded', async () => {
    await withFetch(async () => new Response('x'.repeat(5000), { status: 404 }), async () => {
        await assert.rejects(callLLM(HISTORY, OPTIONS), (err) => {
            assert.equal(err.status, 404);
            assert.equal(err.body.raw.length, 2000);
            assert.deepEqual(err.headers, {});
            return true;
        });
    });
});

test('HTTP errors tolerate minimal response objects without headers', async () => {
    await withFetch(async () => ({ ok: false, status: 502, text: async () => 'bad gateway' }), async () => {
        await assert.rejects(drain(callLLMStreaming(HISTORY, OPTIONS)), (err) => {
            assert.equal(err.status, 502);
            assert.deepEqual(err.body, { raw: 'bad gateway' });
            return true;
        });
    });
});

test('an in-stream error before any output is marked as not after output', async () => {
    await withFetch(async () => sseResponse([
        { error: { code: 502, message: 'Provider returned error' }, choices: [{ finish_reason: 'error' }] },
    ]), async () => {
        const events = await drain(callLLMStreaming(HISTORY, OPTIONS));
        const errorEvent = events.find((event) => event.type === 'error');
        assert.ok(errorEvent);
        assert.equal(errorEvent.error.status, 502);
        assert.equal(errorEvent.error.afterOutput, false);
        assert.equal(errorEvent.error.body.error.message, 'Provider returned error');
    });
});

test('an in-stream error after text output is marked as after output', async () => {
    await withFetch(async () => sseResponse([
        { choices: [{ index: 0, delta: { content: 'partial' } }] },
        { error: { code: 'server_error', message: 'upstream dropped' } },
    ]), async () => {
        const events = await drain(callLLMStreaming(HISTORY, OPTIONS));
        const errorEvent = events.find((event) => event.type === 'error');
        assert.equal(errorEvent.error.afterOutput, true);
        assert.equal(errorEvent.error.status, undefined);
    });
});
