import { STATUS_CODES } from 'node:http';

import { toOpenAIChatMessages } from '../messageAdapters/openAIChat.mjs';
import { parseSSEStream } from './sseParser.mjs';

export async function callLLM(chatContext, options) {
    if (!options || typeof options !== 'object') {
        throw new Error('Hugging Face provider requires invocation options.');
    }

    const { model, apiKey, baseURL, signal, params, headers } = options;

    if (!model) {
        throw new Error('Hugging Face provider requires a model name.');
    }
    if (!baseURL) {
        throw new Error('Hugging Face provider requires a baseURL.');
    }

    const messages = toOpenAIChatMessages(chatContext);
    const payload = {
        model,
        messages,
    };

    if (params && typeof params === 'object') {
        Object.assign(payload, params);
    }

    const response = await fetch(baseURL, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${apiKey || ''}`,
            'Content-Type': 'application/json',
            ...(headers || {}),
        },
        body: JSON.stringify(payload),
        signal,
    });

    if (!response.ok) {
        throw new Error(`Hugging Face API request failed: ${response.status} - ${response.statusText || STATUS_CODES[response.status] || 'Unknown Error'}.`);
    }

    const data = await response.json();

    const content = data.choices?.[0]?.message?.content;
    if (content) {
        return typeof content === 'string' ? content : JSON.stringify(content);
    }

    if (data.error) {
        throw new Error(`Hugging Face API returned an error: ${typeof data.error === 'string' ? data.error : data.error.message || 'Unknown provider error.'}`);
    }

    return typeof data === 'string' ? data : JSON.stringify(data);
}

/**
 * Streaming variant of callLLM for Hugging Face.
 *
 * Uses the OpenAI-compatible streaming format: `stream: true` in payload,
 * SSE chunks with `choices[0].delta.content`, sentinel `[DONE]`.
 *
 * @param {Array}  chatContext - Conversation history.
 * @param {object} options     - Same shape as callLLM options.
 * @yields {StreamChunk}
 */
export async function* callLLMStreaming(chatContext, options) {
    if (!options || typeof options !== 'object') {
        throw new Error('Hugging Face provider requires invocation options.');
    }

    const { model, apiKey, baseURL, signal, params, headers } = options;

    if (!model) throw new Error('Hugging Face provider requires a model name.');
    if (!baseURL) throw new Error('Hugging Face provider requires a baseURL.');

    const messages = toOpenAIChatMessages(chatContext);
    const payload = {
        model,
        messages,
        stream: true,
    };

    if (params && typeof params === 'object') {
        Object.assign(payload, params);
    }

    const response = await fetch(baseURL, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${apiKey || ''}`,
            'Content-Type': 'application/json',
            ...(headers || {}),
        },
        body: JSON.stringify(payload),
        signal,
    });

    if (!response.ok) {
        throw new Error(`Hugging Face API request failed: ${response.status} - ${response.statusText || STATUS_CODES[response.status] || 'Unknown Error'}.`);
    }

    let fullText = '';
    let usage = null;

    try {
        for await (const frame of parseSSEStream(response.body)) {
            const data = frame.parsedData;
            if (!data) continue;

            if (data.error) {
                yield {
                    type: 'error',
                    error: new Error(`Hugging Face API returned an error: ${typeof data.error === 'string' ? data.error : data.error.message || 'Unknown provider error.'}`),
                };
                return;
            }

            if (data.usage) {
                usage = data.usage;
            }

            const content = data.choices?.[0]?.delta?.content;
            if (typeof content === 'string' && content.length > 0) {
                fullText += content;
                yield { type: 'text_delta', text: content };
            }
        }
    } catch (err) {
        yield { type: 'error', error: err };
        return;
    }

    yield { type: 'done', fullText, usage };
}
