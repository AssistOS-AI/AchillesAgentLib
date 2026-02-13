import { toOpenAIChatMessages } from '../messageAdapters/openAIChat.mjs';
import { parseSSEStream } from './sseParser.mjs';

function deriveProviderLabel(baseURL) {
    const match = baseURL.match(/https?:\/\/api\.([^/]+)\/v1\//i);
    return match?.[1] || 'OpenAI';
}

export async function callLLM(chatContext, options) {
    if (!options || typeof options !== 'object') {
        throw new Error('OpenAI provider requires invocation options.');
    }

    const { model, apiKey, baseURL, signal, params, headers } = options;
    const providerLabel = deriveProviderLabel(baseURL);
    if (!model) {
        throw new Error(`${providerLabel} provider requires a model name.`);
    }
    if (!apiKey) {
        throw new Error(`${providerLabel} provider requires an API key.`);
    }
    if (!baseURL) {
        throw new Error(`${providerLabel} provider requires a baseURL.`);
    }

    const convertedContext = toOpenAIChatMessages(chatContext);
    const payload = {
        model,
        messages: convertedContext,
    };

    if (params && typeof params === 'object') {
        Object.assign(payload, params);
    }

    const response = await fetch(baseURL, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            ...(headers || {}),
        },
        body: JSON.stringify(payload),
        signal,
    });

    if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`${providerLabel} API Error (${response.status}): ${errorBody}`);
    }

    const data = await response.json();
    if (data.error) {
        throw new Error(`${providerLabel} API Error: ${JSON.stringify(data.error)}`);
    }
    return data.choices?.[0]?.message?.content;
}

/**
 * Streaming variant of callLLM for OpenAI Chat Completions.
 *
 * Sets `stream: true`, parses SSE chunks where each `data:` line contains JSON
 * with `choices[0].delta.content`.  Final frame is `data: [DONE]`.
 *
 * Also used by OpenRouter, xAI, and Mistral (they share this module).
 *
 * @param {Array}  chatContext - Conversation history.
 * @param {object} options     - Same shape as callLLM options.
 * @yields {StreamChunk}
 */
export async function* callLLMStreaming(chatContext, options) {
    if (!options || typeof options !== 'object') {
        throw new Error('OpenAI provider requires invocation options.');
    }

    const { model, apiKey, baseURL, signal, params, headers } = options;
    const providerLabel = deriveProviderLabel(baseURL);
    if (!model) throw new Error(`${providerLabel} provider requires a model name.`);
    if (!apiKey) throw new Error(`${providerLabel} provider requires an API key.`);
    if (!baseURL) throw new Error(`${providerLabel} provider requires a baseURL.`);

    const convertedContext = toOpenAIChatMessages(chatContext);
    const payload = {
        model,
        messages: convertedContext,
        stream: true,
    };

    if (params && typeof params === 'object') {
        Object.assign(payload, params);
    }

    const response = await fetch(baseURL, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            ...(headers || {}),
        },
        body: JSON.stringify(payload),
        signal,
    });

    if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`${providerLabel} API Error (${response.status}): ${errorBody}`);
    }

    let fullText = '';
    let usage = null;

    try {
        for await (const frame of parseSSEStream(response.body)) {
            const data = frame.parsedData;
            if (!data) continue;

            if (data.error) {
                yield { type: 'error', error: new Error(`${providerLabel} API Error: ${JSON.stringify(data.error)}`) };
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
