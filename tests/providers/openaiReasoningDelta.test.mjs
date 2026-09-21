import { test } from 'node:test';
import assert from 'node:assert/strict';

import { callLLMStreaming } from '../../utils/LLMProviders/providers/openai.mjs';

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

function sseData(data) {
    return `data: ${JSON.stringify(data)}\n\n`;
}

async function collectWith(sseChunks) {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: true, status: 200, body: streamFromChunks(sseChunks) });
    try {
        const chunks = [];
        for await (const chunk of callLLMStreaming([{ role: 'user', message: 'Hi' }], {
            model: 'vendor/model:free',
            apiKey: 'k',
            baseURL: 'https://example.invalid/v1',
        })) {
            chunks.push(chunk);
        }
        return chunks;
    } finally {
        globalThis.fetch = originalFetch;
    }
}

test('openai: reasoning deltas yield thinking_delta, never text_delta', async () => {
    const chunks = await collectWith([
        ': OPENROUTER PROCESSING\n\n',
        sseData({ choices: [{ delta: { role: 'assistant', content: '', reasoning: 'Let me ' } }] }),
        sseData({ choices: [{ delta: { reasoning_content: 'think.' } }] }),
        sseData({ choices: [{ delta: { reasoning: '' } }] }),
        sseData({ choices: [{ delta: { content: 'Answer' } }] }),
        sseData({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 2, completion_tokens: 3 } }),
        'data: [DONE]\n\n',
    ]);

    assert.deepEqual(
        chunks.filter((c) => c.type === 'thinking_delta'),
        [
            { type: 'thinking_delta', thinking: 'Let me ' },
            { type: 'thinking_delta', thinking: 'think.' },
        ]
    );
    assert.deepEqual(
        chunks.filter((c) => c.type === 'text_delta'),
        [{ type: 'text_delta', text: 'Answer' }]
    );
    const done = chunks.at(-1);
    assert.equal(done.type, 'done');
    assert.equal(done.fullText, 'Answer');
    assert.equal(done.toolCalls, null);
    assert.equal(done.stopReason, 'stop');
    assert.deepEqual(done.usage, { prompt_tokens: 2, completion_tokens: 3 });
});

test('openai: SSE comments alone yield nothing but done', async () => {
    const chunks = await collectWith([': keepalive\n\n', ': keepalive\n\n', 'data: [DONE]\n\n']);
    assert.deepEqual(chunks.map((c) => c.type), ['done']);
    assert.equal(chunks[0].fullText, '');
});

test('openai: reasoning in the same delta as content keeps the answer intact', async () => {
    const chunks = await collectWith([
        sseData({ choices: [{ delta: { reasoning: 'r', content: 'A' } }] }),
        sseData({ choices: [{ delta: { content: 'B' } }] }),
        'data: [DONE]\n\n',
    ]);
    assert.deepEqual(chunks.map((c) => c.type), ['thinking_delta', 'text_delta', 'text_delta', 'done']);
    assert.equal(chunks.at(-1).fullText, 'AB');
});
