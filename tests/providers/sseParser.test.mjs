import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseSSEStream } from '../../utils/LLMProviders/providers/sseParser.mjs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a ReadableStream from an array of string chunks, simulating
 * how a network response body arrives in pieces.
 */
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

/** Collect all yielded frames from the async generator into an array. */
async function collect(stream, options) {
    const frames = [];
    for await (const frame of parseSSEStream(stream, options)) {
        frames.push(frame);
    }
    return frames;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('parses a single SSE frame with data field', async () => {
    const stream = streamFromChunks(['data: hello world\n\n']);
    const frames = await collect(stream);

    assert.equal(frames.length, 1);
    assert.equal(frames[0].data, 'hello world');
    assert.equal(frames[0].event, '');
    assert.equal(frames[0].id, '');
    assert.equal(frames[0].parsedData, null); // not valid JSON
});

test('parses JSON data into parsedData', async () => {
    const json = JSON.stringify({ choices: [{ delta: { content: 'hi' } }] });
    const stream = streamFromChunks([`data: ${json}\n\n`]);
    const frames = await collect(stream);

    assert.equal(frames.length, 1);
    assert.deepEqual(frames[0].parsedData, { choices: [{ delta: { content: 'hi' } }] });
    assert.equal(frames[0].data, json);
});

test('parses event and id fields', async () => {
    const stream = streamFromChunks([
        'event: content_block_delta\nid: msg_123\ndata: {"type":"text_delta","text":"Hi"}\n\n',
    ]);
    const frames = await collect(stream);

    assert.equal(frames.length, 1);
    assert.equal(frames[0].event, 'content_block_delta');
    assert.equal(frames[0].id, 'msg_123');
    assert.deepEqual(frames[0].parsedData, { type: 'text_delta', text: 'Hi' });
});

test('parses multiple frames in a single chunk', async () => {
    const stream = streamFromChunks([
        'data: one\n\ndata: two\n\ndata: three\n\n',
    ]);
    const frames = await collect(stream);

    assert.equal(frames.length, 3);
    assert.equal(frames[0].data, 'one');
    assert.equal(frames[1].data, 'two');
    assert.equal(frames[2].data, 'three');
});

test('handles frames split across multiple chunks', async () => {
    // The frame boundary (\n\n) is split between chunk 1 and chunk 2
    const stream = streamFromChunks([
        'data: first\n',
        '\ndata: second\n\n',
    ]);
    const frames = await collect(stream);

    assert.equal(frames.length, 2);
    assert.equal(frames[0].data, 'first');
    assert.equal(frames[1].data, 'second');
});

test('handles a field split mid-chunk', async () => {
    // "data: hel" in chunk 1, "lo\n\n" in chunk 2
    const stream = streamFromChunks([
        'data: hel',
        'lo\n\n',
    ]);
    const frames = await collect(stream);

    assert.equal(frames.length, 1);
    assert.equal(frames[0].data, 'hello');
});

test('stops at [DONE] sentinel', async () => {
    const stream = streamFromChunks([
        'data: keep\n\ndata: [DONE]\n\ndata: discard\n\n',
    ]);
    const frames = await collect(stream);

    assert.equal(frames.length, 1);
    assert.equal(frames[0].data, 'keep');
});

test('supports custom done sentinel', async () => {
    const stream = streamFromChunks([
        'data: keep\n\ndata: END\n\ndata: discard\n\n',
    ]);
    const frames = await collect(stream, { doneSentinel: 'END' });

    assert.equal(frames.length, 1);
    assert.equal(frames[0].data, 'keep');
});

test('ignores comment lines', async () => {
    const stream = streamFromChunks([
        ': this is a comment\ndata: visible\n\n',
    ]);
    const frames = await collect(stream);

    assert.equal(frames.length, 1);
    assert.equal(frames[0].data, 'visible');
});

test('handles multi-line data (joined with newlines)', async () => {
    const stream = streamFromChunks([
        'data: line one\ndata: line two\ndata: line three\n\n',
    ]);
    const frames = await collect(stream);

    assert.equal(frames.length, 1);
    assert.equal(frames[0].data, 'line one\nline two\nline three');
    // Multi-line data is not valid JSON, parsedData should be null
    assert.equal(frames[0].parsedData, null);
});

test('handles empty data field', async () => {
    const stream = streamFromChunks(['data:\n\n']);
    const frames = await collect(stream);

    assert.equal(frames.length, 1);
    assert.equal(frames[0].data, '');
    assert.equal(frames[0].parsedData, null);
});

test('handles field with no colon (field-only line)', async () => {
    // Per SSE spec, a line with no colon treats the entire line as the field
    // name with empty value. 'data' without colon sets data to ''.
    const stream = streamFromChunks(['data\n\n']);
    const frames = await collect(stream);

    assert.equal(frames.length, 1);
    assert.equal(frames[0].data, '');
});

test('skips blank frames between events', async () => {
    // Multiple \n\n in a row should not produce empty frames
    const stream = streamFromChunks([
        'data: alpha\n\n\n\ndata: beta\n\n',
    ]);
    const frames = await collect(stream);

    assert.equal(frames.length, 2);
    assert.equal(frames[0].data, 'alpha');
    assert.equal(frames[1].data, 'beta');
});

test('handles trailing data after stream ends without final \\n\\n', async () => {
    // Stream closes before the final \n\n delimiter
    const stream = streamFromChunks(['data: leftover']);
    const frames = await collect(stream);

    assert.equal(frames.length, 1);
    assert.equal(frames[0].data, 'leftover');
});

test('strips single leading space after colon per SSE spec', async () => {
    const stream = streamFromChunks(['data:  two spaces\n\n']);
    const frames = await collect(stream);

    // Only one space stripped: " two spaces" -> " two spaces" minus leading = " two spaces"
    // Actually: "data:  two spaces" → field "data", value " two spaces" (strip one leading space → " two spaces")
    assert.equal(frames[0].data, ' two spaces');
});

test('realistic Anthropic SSE stream', async () => {
    const stream = streamFromChunks([
        'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1"}}\n\n',
        'event: content_block_start\ndata: {"type":"content_block_start","index":0}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":" world"}}\n\n',
        'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
        'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}\n\n',
        'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ]);
    const frames = await collect(stream);

    assert.equal(frames.length, 7);
    assert.equal(frames[0].event, 'message_start');
    assert.equal(frames[2].event, 'content_block_delta');
    assert.equal(frames[2].parsedData.delta.text, 'Hello');
    assert.equal(frames[3].parsedData.delta.text, ' world');
    assert.equal(frames[6].event, 'message_stop');
});

test('realistic OpenAI SSE stream', async () => {
    const chunk1 = JSON.stringify({ choices: [{ delta: { content: 'Hi' } }] });
    const chunk2 = JSON.stringify({ choices: [{ delta: { content: ' there' } }] });
    const stream = streamFromChunks([
        `data: ${chunk1}\n\n`,
        `data: ${chunk2}\n\n`,
        'data: [DONE]\n\n',
    ]);
    const frames = await collect(stream);

    assert.equal(frames.length, 2);
    assert.equal(frames[0].parsedData.choices[0].delta.content, 'Hi');
    assert.equal(frames[1].parsedData.choices[0].delta.content, ' there');
});

test('realistic Google Gemini SSE stream', async () => {
    const chunk = JSON.stringify({
        candidates: [{ content: { parts: [{ text: 'Gemini says hi' }] } }],
    });
    const stream = streamFromChunks([`data: ${chunk}\n\n`]);
    const frames = await collect(stream);

    assert.equal(frames.length, 1);
    assert.equal(frames[0].parsedData.candidates[0].content.parts[0].text, 'Gemini says hi');
});

test('empty stream yields no frames', async () => {
    const stream = streamFromChunks([]);
    const frames = await collect(stream);

    assert.equal(frames.length, 0);
});

test('reader lock is released after iteration', async () => {
    const stream = streamFromChunks(['data: test\n\n']);
    const frames = await collect(stream);
    assert.equal(frames.length, 1);

    // After the generator completes, the reader lock should be released.
    // Getting a new reader should not throw.
    const reader = stream.getReader();
    const { done } = await reader.read();
    assert.equal(done, true);
    reader.releaseLock();
});
