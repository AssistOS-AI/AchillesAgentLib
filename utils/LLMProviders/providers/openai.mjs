import { toOpenAIChatMessages } from '../messageAdapters/openAIChat.mjs';
import { parseSSEStream } from './sseParser.mjs';

function deriveProviderLabel(baseURL) {
    const match = baseURL.match(/https?:\/\/api\.([^/]+)\/?/i);
    return match?.[1] || 'OpenAI';
}

function resolveChatCompletionsURL(baseURL) {
    const trimmed = (baseURL || '').replace(/\/+$/, '');
    if (!trimmed) {
        return 'https://api.openai.com/v1/chat/completions';
    }

    if (trimmed.endsWith('/chat/completions')) {
        return trimmed;
    }

    if (trimmed.endsWith('/v1')) {
        return `${trimmed}/chat/completions`;
    }

    return `${trimmed}/v1/chat/completions`;
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

    const response = await fetch(resolveChatCompletionsURL(baseURL), {
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

    const response = await fetch(resolveChatCompletionsURL(baseURL), {
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
    const toolCallAccum = [];
    let stopReason = null;

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

            const choice = data.choices?.[0];
            if (!choice) continue;

            if (choice.finish_reason) {
                stopReason = choice.finish_reason;
            }

            const delta = choice.delta;
            if (!delta) continue;

            // Content delta
            if (typeof delta.content === 'string' && delta.content.length > 0) {
                fullText += delta.content;
                yield { type: 'text_delta', text: delta.content };
            }

            // Tool calls delta — accumulate incrementally
            if (Array.isArray(delta.tool_calls)) {
                for (const tc of delta.tool_calls) {
                    const idx = tc.index ?? 0;
                    if (!toolCallAccum[idx]) {
                        toolCallAccum[idx] = {
                            id: tc.id || '',
                            type: tc.type || 'function',
                            function: { name: tc.function?.name || '', arguments: '' },
                        };
                    } else {
                        if (tc.id) toolCallAccum[idx].id = tc.id;
                        if (tc.function?.name) toolCallAccum[idx].function.name = tc.function.name;
                    }
                    if (tc.function?.arguments) {
                        toolCallAccum[idx].function.arguments += tc.function.arguments;
                    }
                }
                yield { type: 'tool_calls_delta', toolCalls: delta.tool_calls };
            }
        }
    } catch (err) {
        yield { type: 'error', error: err };
        return;
    }

    const toolCalls = toolCallAccum.filter(Boolean);
    yield {
        type: 'done',
        fullText,
        toolCalls: toolCalls.length > 0 ? toolCalls : null,
        usage,
        stopReason: stopReason || 'stop',
    };
}
