import { test } from 'node:test';
import assert from 'node:assert/strict';

import { callLLMStreaming } from '../../utils/LLMProviders/providers/anthropic.mjs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function streamFromChunks(chunks) {
    const encoder = new TextEncoder();
    let index = 0;
    return new ReadableStream({
        pull(controller) {
            if (index < chunks.length) {
                controller.enqueue(encoder.encode(chunks[index++]));
            } else {
                controller.close();
            }
        },
    });
}

function sseEvent(eventType, data) {
    const json = typeof data === 'string' ? data : JSON.stringify(data);
    return `event: ${eventType}\ndata: ${json}\n\n`;
}

/**
 * Builds a mock global.fetch that returns the given SSE chunks as a streaming
 * response body.  Restores the original fetch when done.
 */
function mockFetch(sseChunks, { status = 200, validate } = {}) {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
        if (validate) validate(url, init);
        if (status !== 200) {
            return { ok: false, status, text: async () => 'error body' };
        }
        return {
            ok: true,
            status: 200,
            body: streamFromChunks(sseChunks),
        };
    };
    return () => { globalThis.fetch = originalFetch; };
}

async function collect(gen) {
    const chunks = [];
    for await (const chunk of gen) {
        chunks.push(chunk);
    }
    return chunks;
}

const BASE_OPTIONS = {
    model: 'claude-sonnet-4-5',
    apiKey: 'test-key',
    baseURL: 'https://api.anthropic.com/v1/messages',
};

const DUMMY_HISTORY = [
    { role: 'user', message: 'Hello' },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('streams text deltas and yields done with fullText', async () => {
    const restore = mockFetch([
        sseEvent('message_start', {
            type: 'message_start',
            message: { id: 'msg_1', usage: { input_tokens: 10 } },
        }),
        sseEvent('content_block_start', { type: 'content_block_start', index: 0 }),
        sseEvent('content_block_delta', {
            type: 'content_block_delta',
            delta: { type: 'text_delta', text: 'Hello' },
        }),
        sseEvent('content_block_delta', {
            type: 'content_block_delta',
            delta: { type: 'text_delta', text: ' world' },
        }),
        sseEvent('content_block_stop', { type: 'content_block_stop', index: 0 }),
        sseEvent('message_delta', {
            type: 'message_delta',
            delta: { stop_reason: 'end_turn' },
            usage: { output_tokens: 5 },
        }),
        sseEvent('message_stop', { type: 'message_stop' }),
    ]);

    try {
        const chunks = await collect(callLLMStreaming(DUMMY_HISTORY, BASE_OPTIONS));

        const textDeltas = chunks.filter(c => c.type === 'text_delta');
        assert.equal(textDeltas.length, 2);
        assert.equal(textDeltas[0].text, 'Hello');
        assert.equal(textDeltas[1].text, ' world');

        const done = chunks.find(c => c.type === 'done');
        assert.ok(done, 'should have a done chunk');
        assert.equal(done.fullText, 'Hello world');
        assert.deepEqual(done.usage, { input_tokens: 10, output_tokens: 5, completion_tokens: 5, total_tokens: 15 });
    } finally {
        restore();
    }
});

test('yields thinking_delta chunks for extended thinking', async () => {
    const restore = mockFetch([
        sseEvent('message_start', {
            type: 'message_start',
            message: { id: 'msg_2', usage: { input_tokens: 5 } },
        }),
        sseEvent('content_block_start', {
            type: 'content_block_start',
            index: 0,
            content_block: { type: 'thinking' },
        }),
        sseEvent('content_block_delta', {
            type: 'content_block_delta',
            delta: { type: 'thinking_delta', thinking: 'Let me think...' },
        }),
        sseEvent('content_block_delta', {
            type: 'content_block_delta',
            delta: { type: 'thinking_delta', thinking: ' about this.' },
        }),
        sseEvent('content_block_stop', { type: 'content_block_stop', index: 0 }),
        sseEvent('content_block_start', {
            type: 'content_block_start',
            index: 1,
            content_block: { type: 'text' },
        }),
        sseEvent('content_block_delta', {
            type: 'content_block_delta',
            delta: { type: 'text_delta', text: 'The answer is 42.' },
        }),
        sseEvent('content_block_stop', { type: 'content_block_stop', index: 1 }),
        sseEvent('message_delta', {
            type: 'message_delta',
            delta: { stop_reason: 'end_turn' },
            usage: { output_tokens: 20 },
        }),
        sseEvent('message_stop', { type: 'message_stop' }),
    ]);

    try {
        const chunks = await collect(callLLMStreaming(DUMMY_HISTORY, BASE_OPTIONS));

        const thinking = chunks.filter(c => c.type === 'thinking_delta');
        assert.equal(thinking.length, 2);
        assert.equal(thinking[0].thinking, 'Let me think...');
        assert.equal(thinking[1].thinking, ' about this.');

        const textDeltas = chunks.filter(c => c.type === 'text_delta');
        assert.equal(textDeltas.length, 1);
        assert.equal(textDeltas[0].text, 'The answer is 42.');

        const done = chunks.find(c => c.type === 'done');
        assert.equal(done.fullText, 'The answer is 42.');
    } finally {
        restore();
    }
});

test('yields error chunk on API-level error event', async () => {
    const restore = mockFetch([
        sseEvent('message_start', {
            type: 'message_start',
            message: { id: 'msg_3' },
        }),
        sseEvent('error', {
            type: 'error',
            error: { type: 'overloaded_error', message: 'Overloaded' },
        }),
    ]);

    try {
        const chunks = await collect(callLLMStreaming(DUMMY_HISTORY, BASE_OPTIONS));

        const errorChunk = chunks.find(c => c.type === 'error');
        assert.ok(errorChunk, 'should yield an error chunk');
        assert.ok(errorChunk.error instanceof Error);
        assert.equal(errorChunk.error.message, 'Anthropic API returned an error: Overloaded');

        // No done chunk after an error
        assert.equal(chunks.find(c => c.type === 'done'), undefined);
    } finally {
        restore();
    }
});

test('throws on non-200 HTTP response', async () => {
    const restore = mockFetch([], { status: 429 });

    try {
        await assert.rejects(
            async () => {
                // The generator throws on instantiation (before first yield)
                // because the fetch error happens during the initial await.
                const gen = callLLMStreaming(DUMMY_HISTORY, BASE_OPTIONS);
                await gen.next();
            },
            (err) => {
                assert.ok(err.message.includes('429'));
                return true;
            },
        );
    } finally {
        restore();
    }
});

test('throws on missing required options', async () => {
    await assert.rejects(
        async () => {
            const gen = callLLMStreaming(DUMMY_HISTORY, { model: 'x', apiKey: 'x' });
            await gen.next();
        },
        /baseURL/,
    );

    await assert.rejects(
        async () => {
            const gen = callLLMStreaming(DUMMY_HISTORY, { model: 'x', baseURL: 'x' });
            await gen.next();
        },
        /API key/,
    );

    await assert.rejects(
        async () => {
            const gen = callLLMStreaming(DUMMY_HISTORY, { apiKey: 'x', baseURL: 'x' });
            await gen.next();
        },
        /model name/,
    );
});

test('sends stream: true in request payload', async () => {
    let capturedBody = null;
    const restore = mockFetch(
        [sseEvent('message_stop', { type: 'message_stop' })],
        {
            validate: (_url, init) => {
                capturedBody = JSON.parse(init.body);
            },
        },
    );

    try {
        await collect(callLLMStreaming(DUMMY_HISTORY, BASE_OPTIONS));
        assert.equal(capturedBody.stream, true);
        assert.equal(capturedBody.model, 'claude-sonnet-4-5');
    } finally {
        restore();
    }
});

test('passes signal, params, and headers through to fetch', async () => {
    let capturedInit = null;
    let capturedBody = null;
    const controller = new AbortController();

    const restore = mockFetch(
        [sseEvent('message_stop', { type: 'message_stop' })],
        {
            validate: (_url, init) => {
                capturedInit = init;
                capturedBody = JSON.parse(init.body);
            },
        },
    );

    try {
        await collect(callLLMStreaming(DUMMY_HISTORY, {
            ...BASE_OPTIONS,
            signal: controller.signal,
            params: { max_tokens: 4096, temperature: 0.7 },
            headers: { 'x-custom': 'value' },
        }));

        assert.equal(capturedInit.signal, controller.signal);
        assert.equal(capturedInit.headers['x-custom'], 'value');
        assert.equal(capturedBody.max_tokens, 4096);
        assert.equal(capturedBody.temperature, 0.7);
        assert.equal(capturedBody.stream, true);
    } finally {
        restore();
    }
});

test('handles stream with only message_start and message_stop (empty response)', async () => {
    const restore = mockFetch([
        sseEvent('message_start', {
            type: 'message_start',
            message: { id: 'msg_empty', usage: { input_tokens: 3 } },
        }),
        sseEvent('message_delta', {
            type: 'message_delta',
            delta: { stop_reason: 'end_turn' },
            usage: { output_tokens: 0 },
        }),
        sseEvent('message_stop', { type: 'message_stop' }),
    ]);

    try {
        const chunks = await collect(callLLMStreaming(DUMMY_HISTORY, BASE_OPTIONS));

        const done = chunks.find(c => c.type === 'done');
        assert.ok(done);
        assert.equal(done.fullText, '');
        assert.deepEqual(done.usage, { input_tokens: 3, output_tokens: 0, completion_tokens: 0, total_tokens: 3 });
    } finally {
        restore();
    }
});

test('yields error chunk when stream body read fails mid-stream', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
        let pullCount = 0;
        const encoder = new TextEncoder();
        const body = new ReadableStream({
            pull(controller) {
                pullCount++;
                if (pullCount === 1) {
                    const evt = sseEvent('content_block_delta', {
                        type: 'content_block_delta',
                        delta: { type: 'text_delta', text: 'partial' },
                    });
                    controller.enqueue(encoder.encode(evt));
                } else {
                    controller.error(new Error('network failure'));
                }
            },
        });
        return { ok: true, status: 200, body };
    };

    try {
        const chunks = await collect(callLLMStreaming(DUMMY_HISTORY, BASE_OPTIONS));

        const textChunk = chunks.find(c => c.type === 'text_delta');
        assert.ok(textChunk);
        assert.equal(textChunk.text, 'partial');

        const errorChunk = chunks.find(c => c.type === 'error');
        assert.ok(errorChunk, 'should yield error chunk on stream failure');
        assert.ok(errorChunk.error.message.includes('network failure'));
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('skips frames with no parsedData', async () => {
    // A comment-only frame or a frame with non-JSON data should be skipped
    const encoder = new TextEncoder();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
        ok: true,
        status: 200,
        body: streamFromChunks([
            ': keep-alive\n\n',
            'data: not valid json\n\n',
            sseEvent('content_block_delta', {
                type: 'content_block_delta',
                delta: { type: 'text_delta', text: 'real data' },
            }),
            sseEvent('message_stop', { type: 'message_stop' }),
        ]),
    });

    try {
        const chunks = await collect(callLLMStreaming(DUMMY_HISTORY, BASE_OPTIONS));

        const textDeltas = chunks.filter(c => c.type === 'text_delta');
        assert.equal(textDeltas.length, 1);
        assert.equal(textDeltas[0].text, 'real data');
    } finally {
        globalThis.fetch = originalFetch;
    }
});
