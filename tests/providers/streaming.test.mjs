import { test } from 'node:test';
import assert from 'node:assert/strict';

import { callLLMStreaming as openaiStreaming } from '../../utils/LLMProviders/providers/openai.mjs';
import { callLLMStreaming as openaiResponsesStreaming } from '../../utils/LLMProviders/providers/openaiResponses.mjs';
import { callLLMStreaming as openaiCompletionsStreaming } from '../../utils/LLMProviders/providers/openaiCompletions.mjs';
import { callLLMStreaming as googleStreaming } from '../../utils/LLMProviders/providers/google.mjs';
import { callLLMStreaming as huggingFaceStreaming } from '../../utils/LLMProviders/providers/huggingFace.mjs';

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

function sseData(data) {
    const json = typeof data === 'string' ? data : JSON.stringify(data);
    return `data: ${json}\n\n`;
}

function sseEvent(eventType, data) {
    const json = typeof data === 'string' ? data : JSON.stringify(data);
    return `event: ${eventType}\ndata: ${json}\n\n`;
}

function mockFetch(sseChunks, { status = 200, validate } = {}) {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
        if (validate) validate(url, init);
        if (status !== 200) {
            return { ok: false, status, text: async () => 'error body' };
        }
        return { ok: true, status: 200, body: streamFromChunks(sseChunks) };
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

const DUMMY_HISTORY = [{ role: 'user', message: 'Hello' }];

// ---------------------------------------------------------------------------
// OpenAI Chat Completions
// ---------------------------------------------------------------------------

test('openai: streams text deltas and yields done', async () => {
    const restore = mockFetch([
        sseData({ choices: [{ delta: { role: 'assistant' } }] }),
        sseData({ choices: [{ delta: { content: 'Hello' } }] }),
        sseData({ choices: [{ delta: { content: ' world' } }] }),
        sseData({ choices: [{ delta: {} }], usage: { prompt_tokens: 5, completion_tokens: 2 } }),
        'data: [DONE]\n\n',
    ]);
    try {
        const chunks = await collect(openaiStreaming(DUMMY_HISTORY, {
            model: 'gpt-5', apiKey: 'k', baseURL: 'https://api.openai.com/v1/chat/completions',
        }));
        const deltas = chunks.filter(c => c.type === 'text_delta');
        assert.equal(deltas.length, 2);
        assert.equal(deltas[0].text, 'Hello');
        assert.equal(deltas[1].text, ' world');
        const done = chunks.find(c => c.type === 'done');
        assert.equal(done.fullText, 'Hello world');
        assert.deepEqual(done.usage, { prompt_tokens: 5, completion_tokens: 2 });
    } finally {
        restore();
    }
});

test('openai: sends stream: true in payload', async () => {
    let capturedBody = null;
    const restore = mockFetch(['data: [DONE]\n\n'], {
        validate: (_url, init) => { capturedBody = JSON.parse(init.body); },
    });
    try {
        await collect(openaiStreaming(DUMMY_HISTORY, {
            model: 'gpt-5', apiKey: 'k', baseURL: 'https://api.openai.com/v1/chat/completions',
        }));
        assert.equal(capturedBody.stream, true);
        assert.equal(capturedBody.model, 'gpt-5');
        assert.ok(Array.isArray(capturedBody.messages));
    } finally {
        restore();
    }
});

test('openai: throws on HTTP error', async () => {
    const restore = mockFetch([], { status: 500 });
    try {
        await assert.rejects(
            async () => { await collect(openaiStreaming(DUMMY_HISTORY, {
                model: 'gpt-5', apiKey: 'k', baseURL: 'https://api.openai.com/v1/chat/completions',
            })); },
            /500/,
        );
    } finally {
        restore();
    }
});

test('openai: yields error on API error in stream', async () => {
    const restore = mockFetch([
        sseData({ error: { message: 'rate limit', type: 'rate_limit_error' } }),
    ]);
    try {
        const chunks = await collect(openaiStreaming(DUMMY_HISTORY, {
            model: 'gpt-5', apiKey: 'k', baseURL: 'https://api.openai.com/v1/chat/completions',
        }));
        const err = chunks.find(c => c.type === 'error');
        assert.ok(err);
        assert.equal(err.error.message, 'openai.com API returned an error: rate limit');
    } finally {
        restore();
    }
});

test('openai: skips empty delta content', async () => {
    const restore = mockFetch([
        sseData({ choices: [{ delta: { content: '' } }] }),
        sseData({ choices: [{ delta: { content: 'text' } }] }),
        'data: [DONE]\n\n',
    ]);
    try {
        const chunks = await collect(openaiStreaming(DUMMY_HISTORY, {
            model: 'gpt-5', apiKey: 'k', baseURL: 'https://api.openai.com/v1/chat/completions',
        }));
        const deltas = chunks.filter(c => c.type === 'text_delta');
        assert.equal(deltas.length, 1);
        assert.equal(deltas[0].text, 'text');
    } finally {
        restore();
    }
});

test('openai: derives provider label from baseURL for errors', async () => {
    const restore = mockFetch([], { status: 401 });
    try {
        await assert.rejects(
            async () => { await collect(openaiStreaming(DUMMY_HISTORY, {
                model: 'x', apiKey: 'k', baseURL: 'https://api.x.ai/v1/chat/completions',
            })); },
            /x\.ai.*401/,
        );
    } finally {
        restore();
    }
});

// ---------------------------------------------------------------------------
// OpenAI Responses
// ---------------------------------------------------------------------------

test('openaiResponses: streams text deltas from response.output_text.delta events', async () => {
    const restore = mockFetch([
        sseEvent('response.created', { type: 'response.created', response: { id: 'resp_1' } }),
        sseEvent('response.output_text.delta', { type: 'response.output_text.delta', delta: 'Hello' }),
        sseEvent('response.output_text.delta', { type: 'response.output_text.delta', delta: ' there' }),
        sseEvent('response.completed', {
            type: 'response.completed',
            response: { usage: { input_tokens: 3, output_tokens: 2 } },
        }),
    ]);
    try {
        const chunks = await collect(openaiResponsesStreaming(DUMMY_HISTORY, {
            model: 'gpt-5.2-codex', apiKey: 'k', baseURL: 'https://api.openai.com/v1/responses',
        }));
        const deltas = chunks.filter(c => c.type === 'text_delta');
        assert.equal(deltas.length, 2);
        assert.equal(deltas[0].text, 'Hello');
        assert.equal(deltas[1].text, ' there');
        const done = chunks.find(c => c.type === 'done');
        assert.equal(done.fullText, 'Hello there');
        assert.deepEqual(done.usage, { input_tokens: 3, output_tokens: 2 });
    } finally {
        restore();
    }
});

test('openaiResponses: sends stream: true and uses input (not messages)', async () => {
    let capturedBody = null;
    const restore = mockFetch([
        sseEvent('response.completed', { type: 'response.completed' }),
    ], {
        validate: (_url, init) => { capturedBody = JSON.parse(init.body); },
    });
    try {
        await collect(openaiResponsesStreaming(DUMMY_HISTORY, {
            model: 'gpt-5.2-codex', apiKey: 'k', baseURL: 'https://api.openai.com/v1/responses',
        }));
        assert.equal(capturedBody.stream, true);
        assert.ok(Array.isArray(capturedBody.input));
        assert.equal(capturedBody.messages, undefined);
    } finally {
        restore();
    }
});

test('openaiResponses: yields error on error event', async () => {
    const restore = mockFetch([
        sseEvent('error', { type: 'error', error: { message: 'bad request' } }),
    ]);
    try {
        const chunks = await collect(openaiResponsesStreaming(DUMMY_HISTORY, {
            model: 'gpt-5.2-codex', apiKey: 'k', baseURL: 'https://api.openai.com/v1/responses',
        }));
        const err = chunks.find(c => c.type === 'error');
        assert.ok(err);
        assert.ok(err.error.message.includes('bad request'));
    } finally {
        restore();
    }
});

test('openaiResponses: throws on HTTP error', async () => {
    const restore = mockFetch([], { status: 403 });
    try {
        await assert.rejects(
            async () => { await collect(openaiResponsesStreaming(DUMMY_HISTORY, {
                model: 'x', apiKey: 'k', baseURL: 'https://api.openai.com/v1/responses',
            })); },
            /403/,
        );
    } finally {
        restore();
    }
});

// ---------------------------------------------------------------------------
// OpenAI Completions (legacy)
// ---------------------------------------------------------------------------

test('openaiCompletions: streams text deltas from choices[0].text', async () => {
    const restore = mockFetch([
        sseData({ choices: [{ text: 'Once ' }] }),
        sseData({ choices: [{ text: 'upon' }] }),
        sseData({ choices: [{ text: ' a time' }] }),
        'data: [DONE]\n\n',
    ]);
    try {
        const chunks = await collect(openaiCompletionsStreaming(DUMMY_HISTORY, {
            model: 'codex', apiKey: 'k', baseURL: 'https://api.openai.com/v1/completions',
        }));
        const deltas = chunks.filter(c => c.type === 'text_delta');
        assert.equal(deltas.length, 3);
        assert.equal(deltas[0].text, 'Once ');
        assert.equal(deltas[1].text, 'upon');
        assert.equal(deltas[2].text, ' a time');
        const done = chunks.find(c => c.type === 'done');
        assert.equal(done.fullText, 'Once upon a time');
    } finally {
        restore();
    }
});

test('openaiCompletions: sends stream: true and prompt (not messages)', async () => {
    let capturedBody = null;
    const restore = mockFetch(['data: [DONE]\n\n'], {
        validate: (_url, init) => { capturedBody = JSON.parse(init.body); },
    });
    try {
        await collect(openaiCompletionsStreaming(DUMMY_HISTORY, {
            model: 'codex', apiKey: 'k', baseURL: 'https://api.openai.com/v1/completions',
        }));
        assert.equal(capturedBody.stream, true);
        assert.equal(typeof capturedBody.prompt, 'string');
        assert.equal(capturedBody.messages, undefined);
        assert.equal(capturedBody.max_tokens, 16384);
    } finally {
        restore();
    }
});

test('openaiCompletions: yields error on API error in stream', async () => {
    const restore = mockFetch([
        sseData({ error: { message: 'model overloaded' } }),
    ]);
    try {
        const chunks = await collect(openaiCompletionsStreaming(DUMMY_HISTORY, {
            model: 'codex', apiKey: 'k', baseURL: 'https://api.openai.com/v1/completions',
        }));
        const err = chunks.find(c => c.type === 'error');
        assert.ok(err);
        assert.ok(err.error.message.includes('model overloaded'));
    } finally {
        restore();
    }
});

// ---------------------------------------------------------------------------
// Google Gemini
// ---------------------------------------------------------------------------

test('google: streams text deltas from candidates structure', async () => {
    const restore = mockFetch([
        sseData({
            candidates: [{ content: { parts: [{ text: 'Hello' }] } }],
            usageMetadata: { promptTokenCount: 5 },
        }),
        sseData({
            candidates: [{ content: { parts: [{ text: ' from Gemini' }] } }],
            usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 3 },
        }),
    ]);
    try {
        const chunks = await collect(googleStreaming(DUMMY_HISTORY, {
            model: 'gemini-2.5-flash', apiKey: 'k', baseURL: 'https://generativelanguage.googleapis.com/v1beta/models/',
        }));
        const deltas = chunks.filter(c => c.type === 'text_delta');
        assert.equal(deltas.length, 2);
        assert.equal(deltas[0].text, 'Hello');
        assert.equal(deltas[1].text, ' from Gemini');
        const done = chunks.find(c => c.type === 'done');
        assert.equal(done.fullText, 'Hello from Gemini');
        assert.deepEqual(done.usage, { promptTokenCount: 5, candidatesTokenCount: 3 });
    } finally {
        restore();
    }
});

test('google: uses streamGenerateContent endpoint with alt=sse', async () => {
    let capturedURL = null;
    const restore = mockFetch([
        sseData({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }),
    ], {
        validate: (url) => { capturedURL = url; },
    });
    try {
        await collect(googleStreaming(DUMMY_HISTORY, {
            model: 'gemini-2.5-flash',
            apiKey: 'test-api-key',
            baseURL: 'https://generativelanguage.googleapis.com/v1beta/models/',
        }));
        assert.ok(capturedURL.includes('streamGenerateContent'), `URL should contain streamGenerateContent: ${capturedURL}`);
        assert.ok(capturedURL.includes('alt=sse'), `URL should contain alt=sse: ${capturedURL}`);
        assert.ok(capturedURL.includes('key=test-api-key'), `URL should contain the API key: ${capturedURL}`);
        assert.ok(capturedURL.includes('gemini-2.5-flash'), `URL should contain model name: ${capturedURL}`);
    } finally {
        restore();
    }
});

test('google: handles baseURL without trailing slash', async () => {
    let capturedURL = null;
    const restore = mockFetch([
        sseData({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }),
    ], {
        validate: (url) => { capturedURL = url; },
    });
    try {
        await collect(googleStreaming(DUMMY_HISTORY, {
            model: 'gemini-2.5-flash',
            apiKey: 'k',
            baseURL: 'https://generativelanguage.googleapis.com/v1beta/models',
        }));
        assert.ok(capturedURL.includes('/gemini-2.5-flash:streamGenerateContent'));
    } finally {
        restore();
    }
});

test('google: maps params to generationConfig', async () => {
    let capturedBody = null;
    const restore = mockFetch([
        sseData({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }),
    ], {
        validate: (_url, init) => { capturedBody = JSON.parse(init.body); },
    });
    try {
        await collect(googleStreaming(DUMMY_HISTORY, {
            model: 'gemini-2.5-flash', apiKey: 'k',
            baseURL: 'https://generativelanguage.googleapis.com/v1beta/models/',
            params: { temperature: 0.5, maxOutputTokens: 2048 },
        }));
        assert.equal(capturedBody.generationConfig.temperature, 0.5);
        assert.equal(capturedBody.generationConfig.maxOutputTokens, 2048);
    } finally {
        restore();
    }
});

test('google: throws on HTTP error', async () => {
    const restore = mockFetch([], { status: 400 });
    try {
        await assert.rejects(
            async () => { await collect(googleStreaming(DUMMY_HISTORY, {
                model: 'gemini-2.5-flash', apiKey: 'k',
                baseURL: 'https://generativelanguage.googleapis.com/v1beta/models/',
            })); },
            /400/,
        );
    } finally {
        restore();
    }
});

test('google: yields error on API error in stream', async () => {
    const restore = mockFetch([
        sseData({ error: { code: 429, message: 'quota exceeded' } }),
    ]);
    try {
        const chunks = await collect(googleStreaming(DUMMY_HISTORY, {
            model: 'gemini-2.5-flash', apiKey: 'k',
            baseURL: 'https://generativelanguage.googleapis.com/v1beta/models/',
        }));
        const err = chunks.find(c => c.type === 'error');
        assert.ok(err);
        assert.ok(err.error.message.includes('quota exceeded'));
    } finally {
        restore();
    }
});

// ---------------------------------------------------------------------------
// Hugging Face
// ---------------------------------------------------------------------------

test('huggingFace: streams text deltas (OpenAI-compatible format)', async () => {
    const restore = mockFetch([
        sseData({ choices: [{ delta: { content: 'Bonjour' } }] }),
        sseData({ choices: [{ delta: { content: ' monde' } }] }),
        'data: [DONE]\n\n',
    ]);
    try {
        const chunks = await collect(huggingFaceStreaming(DUMMY_HISTORY, {
            model: 'mistralai/Mistral-7B', apiKey: '', baseURL: 'https://router.huggingface.co/v1/chat/completions',
        }));
        const deltas = chunks.filter(c => c.type === 'text_delta');
        assert.equal(deltas.length, 2);
        assert.equal(deltas[0].text, 'Bonjour');
        assert.equal(deltas[1].text, ' monde');
        const done = chunks.find(c => c.type === 'done');
        assert.equal(done.fullText, 'Bonjour monde');
    } finally {
        restore();
    }
});

test('huggingFace: sends stream: true with optional apiKey', async () => {
    let capturedInit = null;
    let capturedBody = null;
    const restore = mockFetch(['data: [DONE]\n\n'], {
        validate: (_url, init) => {
            capturedInit = init;
            capturedBody = JSON.parse(init.body);
        },
    });
    try {
        await collect(huggingFaceStreaming(DUMMY_HISTORY, {
            model: 'x', apiKey: '', baseURL: 'https://router.huggingface.co/v1/chat/completions',
        }));
        assert.equal(capturedBody.stream, true);
        assert.equal(capturedInit.headers.Authorization, 'Bearer ');
    } finally {
        restore();
    }
});

test('huggingFace: throws short standard 503 message', async () => {
    const restore = mockFetch([], { status: 503 });
    try {
        await assert.rejects(
            async () => { await collect(huggingFaceStreaming(DUMMY_HISTORY, {
                model: 'x', baseURL: 'https://router.huggingface.co/v1/chat/completions',
            })); },
            /503 - Service Unavailable/,
        );
    } finally {
        restore();
    }
});

test('huggingFace: yields error on API error in stream', async () => {
    const restore = mockFetch([
        sseData({ error: { message: 'too many requests' } }),
    ]);
    try {
        const chunks = await collect(huggingFaceStreaming(DUMMY_HISTORY, {
            model: 'x', baseURL: 'https://router.huggingface.co/v1/chat/completions',
        }));
        const err = chunks.find(c => c.type === 'error');
        assert.ok(err);
        assert.ok(err.error.message.includes('too many requests'));
    } finally {
        restore();
    }
});

// ---------------------------------------------------------------------------
// Cross-provider: mid-stream network failure
// ---------------------------------------------------------------------------

test('all providers yield error chunk on mid-stream read failure', async () => {
    const originalFetch = globalThis.fetch;

    const makeFailingBody = (firstChunk) => {
        const encoder = new TextEncoder();
        let count = 0;
        return new ReadableStream({
            pull(controller) {
                count++;
                if (count === 1) {
                    controller.enqueue(encoder.encode(firstChunk));
                } else {
                    controller.error(new Error('connection reset'));
                }
            },
        });
    };

    const providers = [
        {
            name: 'openai',
            fn: openaiStreaming,
            opts: { model: 'x', apiKey: 'k', baseURL: 'https://api.openai.com/v1/chat/completions' },
            chunk: sseData({ choices: [{ delta: { content: 'hi' } }] }),
        },
        {
            name: 'openaiCompletions',
            fn: openaiCompletionsStreaming,
            opts: { model: 'x', apiKey: 'k', baseURL: 'https://api.openai.com/v1/completions' },
            chunk: sseData({ choices: [{ text: 'hi' }] }),
        },
        {
            name: 'google',
            fn: googleStreaming,
            opts: { model: 'x', apiKey: 'k', baseURL: 'https://generativelanguage.googleapis.com/v1beta/models/' },
            chunk: sseData({ candidates: [{ content: { parts: [{ text: 'hi' }] } }] }),
        },
        {
            name: 'huggingFace',
            fn: huggingFaceStreaming,
            opts: { model: 'x', baseURL: 'https://router.huggingface.co/v1/chat/completions' },
            chunk: sseData({ choices: [{ delta: { content: 'hi' } }] }),
        },
    ];

    for (const { name, fn, opts, chunk } of providers) {
        globalThis.fetch = async () => ({
            ok: true, status: 200, body: makeFailingBody(chunk),
        });
        try {
            const chunks = await collect(fn(DUMMY_HISTORY, opts));
            const textChunk = chunks.find(c => c.type === 'text_delta');
            assert.ok(textChunk, `${name}: should get text before failure`);
            const errChunk = chunks.find(c => c.type === 'error');
            assert.ok(errChunk, `${name}: should yield error chunk`);
            assert.ok(errChunk.error.message.includes('connection reset'), `${name}: error message`);
        } finally {
            globalThis.fetch = originalFetch;
        }
    }
});

// ---------------------------------------------------------------------------
// Cross-provider: passes params and headers through
// ---------------------------------------------------------------------------

test('all providers forward params and custom headers', async () => {
    const providers = [
        {
            name: 'openai',
            fn: openaiStreaming,
            opts: { model: 'x', apiKey: 'k', baseURL: 'https://api.openai.com/v1/chat/completions' },
            done: 'data: [DONE]\n\n',
        },
        {
            name: 'openaiCompletions',
            fn: openaiCompletionsStreaming,
            opts: { model: 'x', apiKey: 'k', baseURL: 'https://api.openai.com/v1/completions' },
            done: 'data: [DONE]\n\n',
        },
        {
            name: 'huggingFace',
            fn: huggingFaceStreaming,
            opts: { model: 'x', baseURL: 'https://router.huggingface.co/v1/chat/completions' },
            done: 'data: [DONE]\n\n',
        },
    ];

    for (const { name, fn, opts, done } of providers) {
        let capturedInit = null;
        let capturedBody = null;
        const restore = mockFetch([done], {
            validate: (_url, init) => {
                capturedInit = init;
                capturedBody = JSON.parse(init.body);
            },
        });
        try {
            await collect(fn(DUMMY_HISTORY, {
                ...opts,
                params: { temperature: 0.3 },
                headers: { 'x-test': 'yes' },
            }));
            assert.equal(capturedBody.temperature, 0.3, `${name}: temperature`);
            assert.equal(capturedInit.headers['x-test'], 'yes', `${name}: custom header`);
        } finally {
            restore();
        }
    }
});
