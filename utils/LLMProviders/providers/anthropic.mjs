import { toAnthropicMessages } from '../messageAdapters/anthropicMessages.mjs';
import { parseSSEStream } from './sseParser.mjs';

export async function callLLM(chatContext, options) {
    if (!options || typeof options !== 'object') {
        throw new Error('Anthropic provider requires invocation options.');
    }
    const { model, apiKey, baseURL, signal, params, headers } = options;

    if (!model) {
        throw new Error('Anthropic provider requires a model name.');
    }
    if (!apiKey) {
        throw new Error('Anthropic provider requires an API key.');
    }
    if (!baseURL) {
        throw new Error('Anthropic provider requires a baseURL.');
    }

    const { messages, system } = toAnthropicMessages(chatContext);
    const payload = {
        model,
        max_tokens: 1000,
        messages,
    };

    if (system) {
        payload.system = system;
    }

    if (params && typeof params === 'object') {
        Object.assign(payload, params);
    }

    const response = await fetch(baseURL, {
        method: 'POST',
        headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json',
            ...(headers || {}),
        },
        body: JSON.stringify(payload),
        signal,
    });

    if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Anthropic API Error (${response.status}): ${errorBody}`);
    }

    const data = await response.json();
    if (data.error) {
        throw new Error(JSON.stringify(data.error));
    }
    // Find the text content block - some models return thinking blocks first
    const textContent = data.content?.find(c => c.type === 'text');
    return textContent?.text ?? data.content?.[0]?.text;
}

/**
 * Streaming variant of callLLM.  Sets `stream: true` in the payload and
 * yields StreamChunk objects as the Anthropic SSE events arrive.
 *
 * StreamChunk types:
 *   { type: 'text_delta',     text: string }
 *   { type: 'thinking_delta', thinking: string }
 *   { type: 'error',          error: Error }
 *   { type: 'done',           fullText: string, usage?: object }
 *
 * @param {Array}  chatContext - Conversation history.
 * @param {object} options     - Same shape as callLLM options.
 * @yields {StreamChunk}
 */
export async function* callLLMStreaming(chatContext, options) {
    if (!options || typeof options !== 'object') {
        throw new Error('Anthropic provider requires invocation options.');
    }
    const { model, apiKey, baseURL, signal, params, headers } = options;

    if (!model) throw new Error('Anthropic provider requires a model name.');
    if (!apiKey) throw new Error('Anthropic provider requires an API key.');
    if (!baseURL) throw new Error('Anthropic provider requires a baseURL.');

    const { messages, system } = toAnthropicMessages(chatContext);
    const payload = {
        model,
        max_tokens: 1000,
        messages,
        stream: true,
    };

    if (system) {
        payload.system = system;
    }

    if (params && typeof params === 'object') {
        Object.assign(payload, params);
    }

    const response = await fetch(baseURL, {
        method: 'POST',
        headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json',
            ...(headers || {}),
        },
        body: JSON.stringify(payload),
        signal,
    });

    if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Anthropic API Error (${response.status}): ${errorBody}`);
    }

    let fullText = '';
    let usage = null;

    try {
        for await (const frame of parseSSEStream(response.body)) {
            const data = frame.parsedData;
            if (!data) continue;

            if (data.type === 'error') {
                yield { type: 'error', error: new Error(JSON.stringify(data.error)) };
                return;
            }

            // Capture usage from message_start
            if (data.type === 'message_start' && data.message?.usage) {
                usage = { ...data.message.usage };
            }

            // Merge output usage from message_delta
            if (data.type === 'message_delta' && data.usage) {
                usage = usage ? { ...usage, ...data.usage } : { ...data.usage };
            }

            if (data.type === 'content_block_delta') {
                const delta = data.delta;
                if (!delta) continue;

                if (delta.type === 'text_delta' && typeof delta.text === 'string') {
                    fullText += delta.text;
                    yield { type: 'text_delta', text: delta.text };
                } else if (delta.type === 'thinking_delta' && typeof delta.thinking === 'string') {
                    yield { type: 'thinking_delta', thinking: delta.thinking };
                }
            }
        }
    } catch (err) {
        yield { type: 'error', error: err };
        return;
    }

    yield { type: 'done', fullText, usage };
}
