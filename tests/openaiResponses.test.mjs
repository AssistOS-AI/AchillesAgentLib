/**
 * Tests for the OpenAI Responses API provider
 * (utils/LLMProviders/providers/openaiResponses.mjs).
 *
 * Covers the Soul Gateway protocol-family additions:
 *   - resolveResponsesURL detects /backend-api/ endpoints and appends
 *     /responses instead of /v1/responses (Codex ChatGPT backend).
 *   - callLLMStreaming filters system/developer messages from input
 *     when the caller supplies an explicit top-level `instructions`
 *     string via params (required by Codex, harmless for OpenAI).
 *   - callLLMStreaming surfaces structured HTTP errors with a .status
 *     and a parsed .body on the thrown Error.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { callLLMStreaming } from '../utils/LLMProviders/providers/openaiResponses.mjs';

// ─── fetch stub helpers ─────────────────────────────────────────────

let originalFetch;
let fetchCalls;

function stubFetch(handler) {
    originalFetch = globalThis.fetch;
    fetchCalls = [];
    globalThis.fetch = async (url, init) => {
        fetchCalls.push({ url: String(url), init });
        return handler(url, init);
    };
}

function restoreFetch() {
    globalThis.fetch = originalFetch;
    fetchCalls = null;
}

function buildStreamResponse({ events = [], status = 200, statusText = 'OK' } = {}) {
    const encoder = new TextEncoder();
    const body = new ReadableStream({
        start(controller) {
            for (const event of events) {
                const payload = typeof event === 'string' ? event : JSON.stringify(event.data || {});
                const frame = event.event
                    ? `event: ${event.event}\ndata: ${payload}\n\n`
                    : `data: ${payload}\n\n`;
                controller.enqueue(encoder.encode(frame));
            }
            controller.close();
        },
    });
    return new Response(body, {
        status,
        statusText,
        headers: { 'Content-Type': 'text/event-stream' },
    });
}

function buildErrorResponse({ status = 400, body = {} } = {}) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

async function drain(asyncIterable) {
    const collected = [];
    for await (const chunk of asyncIterable) {
        collected.push(chunk);
    }
    return collected;
}

// ─── Tests ──────────────────────────────────────────────────────────

describe('openaiResponses.resolveResponsesURL', () => {
    afterEach(restoreFetch);

    it('appends /v1/responses to a bare api.openai.com base URL', async () => {
        stubFetch(() => buildStreamResponse({ events: [{ event: 'response.completed', data: {} }] }));
        await drain(callLLMStreaming(
            [{ role: 'user', content: 'hi' }],
            { model: 'gpt-4o', apiKey: 'k', baseURL: 'https://api.openai.com' },
        ));
        assert.equal(fetchCalls.length, 1);
        assert.equal(fetchCalls[0].url, 'https://api.openai.com/v1/responses');
    });

    it('appends /responses when the base URL already ends in /v1', async () => {
        stubFetch(() => buildStreamResponse({ events: [{ event: 'response.completed', data: {} }] }));
        await drain(callLLMStreaming(
            [{ role: 'user', content: 'hi' }],
            { model: 'gpt-4o', apiKey: 'k', baseURL: 'https://api.openai.com/v1' },
        ));
        assert.equal(fetchCalls[0].url, 'https://api.openai.com/v1/responses');
    });

    it('passes through a URL that already ends in /responses', async () => {
        stubFetch(() => buildStreamResponse({ events: [{ event: 'response.completed', data: {} }] }));
        await drain(callLLMStreaming(
            [{ role: 'user', content: 'hi' }],
            { model: 'gpt-4o', apiKey: 'k', baseURL: 'https://example.test/custom/responses' },
        ));
        assert.equal(fetchCalls[0].url, 'https://example.test/custom/responses');
    });

    it('appends /responses (NOT /v1/responses) for ChatGPT /backend-api/ URLs', async () => {
        stubFetch(() => buildStreamResponse({ events: [{ event: 'response.completed', data: {} }] }));
        await drain(callLLMStreaming(
            [{ role: 'user', content: 'hi' }],
            { model: 'gpt-5.4', apiKey: 'k', baseURL: 'https://chatgpt.com/backend-api/codex' },
        ));
        assert.equal(fetchCalls[0].url, 'https://chatgpt.com/backend-api/codex/responses');
    });

    it('strips a trailing slash before appending', async () => {
        stubFetch(() => buildStreamResponse({ events: [{ event: 'response.completed', data: {} }] }));
        await drain(callLLMStreaming(
            [{ role: 'user', content: 'hi' }],
            { model: 'gpt-5.4', apiKey: 'k', baseURL: 'https://chatgpt.com/backend-api/codex/' },
        ));
        assert.equal(fetchCalls[0].url, 'https://chatgpt.com/backend-api/codex/responses');
    });
});

describe('openaiResponses.callLLMStreaming — instructions / stripSystem', () => {
    afterEach(restoreFetch);

    it('forwards instructions as a top-level payload field when passed via params', async () => {
        let captured;
        stubFetch((_url, init) => {
            captured = JSON.parse(init.body);
            return buildStreamResponse({ events: [{ event: 'response.completed', data: {} }] });
        });

        await drain(callLLMStreaming(
            [
                { role: 'system', content: 'You are a pirate.' },
                { role: 'user', content: 'hi' },
            ],
            {
                model: 'gpt-5.4',
                apiKey: 'k',
                baseURL: 'https://chatgpt.com/backend-api/codex',
                params: { instructions: 'You are a pirate.' },
            },
        ));

        assert.equal(captured.instructions, 'You are a pirate.');
    });

    it('strips system messages from input[] when params.instructions is set', async () => {
        let captured;
        stubFetch((_url, init) => {
            captured = JSON.parse(init.body);
            return buildStreamResponse({ events: [{ event: 'response.completed', data: {} }] });
        });

        await drain(callLLMStreaming(
            [
                { role: 'system', content: 'You are a pirate.' },
                { role: 'user', content: 'hi' },
                { role: 'assistant', content: 'Ahoy!' },
            ],
            {
                model: 'gpt-5.4',
                apiKey: 'k',
                baseURL: 'https://chatgpt.com/backend-api/codex',
                params: { instructions: 'You are a pirate.' },
            },
        ));

        assert.equal(captured.input.length, 2);
        assert.equal(captured.input[0].role, 'user');
        assert.equal(captured.input[1].role, 'assistant');
        for (const item of captured.input) {
            assert.notEqual(item.role, 'developer');
            assert.notEqual(item.role, 'system');
        }
    });

    it('keeps the existing behaviour (maps system → developer) when instructions is NOT provided', async () => {
        let captured;
        stubFetch((_url, init) => {
            captured = JSON.parse(init.body);
            return buildStreamResponse({ events: [{ event: 'response.completed', data: {} }] });
        });

        await drain(callLLMStreaming(
            [
                { role: 'system', content: 'You are helpful.' },
                { role: 'user', content: 'hi' },
            ],
            {
                model: 'gpt-4o',
                apiKey: 'k',
                baseURL: 'https://api.openai.com/v1',
            },
        ));

        assert.equal(captured.instructions, undefined);
        assert.equal(captured.input.length, 2);
        assert.equal(captured.input[0].role, 'developer');
        assert.equal(captured.input[1].role, 'user');
    });
});

describe('openaiResponses.callLLMStreaming — error surfacing', () => {
    afterEach(restoreFetch);

    it('throws an Error with .status and parsed .body when the upstream returns 400', async () => {
        stubFetch(() => buildErrorResponse({
            status: 400,
            body: { detail: 'Instructions are required' },
        }));

        let caught;
        try {
            await drain(callLLMStreaming(
                [{ role: 'user', content: 'hi' }],
                {
                    model: 'gpt-5.4',
                    apiKey: 'k',
                    baseURL: 'https://chatgpt.com/backend-api/codex',
                },
            ));
        } catch (err) {
            caught = err;
        }

        assert.ok(caught, 'expected an error to be thrown');
        assert.equal(caught.status, 400);
        assert.ok(caught.message.includes('Instructions are required'));
        assert.deepEqual(caught.body, { detail: 'Instructions are required' });
    });

    it('falls back to the raw body text when the error response is not JSON', async () => {
        stubFetch(() => new Response('plain text failure', {
            status: 500,
            headers: { 'Content-Type': 'text/plain' },
        }));

        let caught;
        try {
            await drain(callLLMStreaming(
                [{ role: 'user', content: 'hi' }],
                { model: 'gpt-4o', apiKey: 'k', baseURL: 'https://api.openai.com/v1' },
            ));
        } catch (err) {
            caught = err;
        }

        assert.ok(caught);
        assert.equal(caught.status, 500);
        assert.ok(caught.message.includes('plain text failure'));
        assert.deepEqual(caught.body, { raw: 'plain text failure' });
    });
});

describe('openaiResponses.callLLMStreaming — chunk yield contract', () => {
    afterEach(restoreFetch);

    it('yields text_delta chunks for response.output_text.delta events', async () => {
        stubFetch(() => buildStreamResponse({
            events: [
                { event: 'response.output_text.delta', data: { delta: 'Hi' } },
                { event: 'response.output_text.delta', data: { delta: ' there' } },
                { event: 'response.completed', data: {} },
            ],
        }));

        const chunks = await drain(callLLMStreaming(
            [{ role: 'user', content: 'hi' }],
            { model: 'gpt-5.4', apiKey: 'k', baseURL: 'https://chatgpt.com/backend-api/codex', params: { instructions: 'be brief' } },
        ));

        const textDeltas = chunks.filter((c) => c.type === 'text_delta');
        assert.equal(textDeltas.length, 2);
        assert.equal(textDeltas[0].text, 'Hi');
        assert.equal(textDeltas[1].text, ' there');

        const done = chunks.find((c) => c.type === 'done');
        assert.ok(done);
        assert.equal(done.fullText, 'Hi there');
    });
});
