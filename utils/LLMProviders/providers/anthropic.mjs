import { toAnthropicMessages } from '../messageAdapters/anthropicMessages.mjs';
import { parseSSEStream } from './sseParser.mjs';

function resolveMessagesURL(baseURL) {
    const trimmed = (baseURL || '').replace(/\/+$/, '');
    if (!trimmed) {
        return 'https://api.anthropic.com/v1/messages';
    }

    if (trimmed.endsWith('/messages')) {
        return trimmed;
    }

    if (trimmed.endsWith('/v1')) {
        return `${trimmed}/messages`;
    }

    return `${trimmed}/v1/messages`;
}

function buildHeaders(apiKey, optionsHeaders = {}) {
    const headers = {
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
        ...(optionsHeaders || {}),
    };

    if (!headers.Authorization && apiKey) {
        headers['x-api-key'] = apiKey;
    }

    return headers;
}

export async function callLLM(chatContext, options) {
    if (!options || typeof options !== 'object') {
        throw new Error('Anthropic provider requires invocation options.');
    }
    const { model, apiKey, baseURL, signal, params, headers } = options;

    if (!model) {
        throw new Error('Anthropic provider requires a model name.');
    }
    if (!apiKey && !headers?.Authorization) {
        throw new Error('Anthropic provider requires an API key or Authorization header.');
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

    const response = await fetch(resolveMessagesURL(baseURL), {
        method: 'POST',
        headers: buildHeaders(apiKey, headers),
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
    if (!apiKey && !headers?.Authorization) throw new Error('Anthropic provider requires an API key or Authorization header.');
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

    const response = await fetch(resolveMessagesURL(baseURL), {
        method: 'POST',
        headers: buildHeaders(apiKey, headers),
        body: JSON.stringify(payload),
        signal,
    });

    if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Anthropic API Error (${response.status}): ${errorBody}`);
    }

    let fullText = '';
    let usage = null;
    const toolCallAccum = [];
    let stopReason = null;

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

            // content_block_start: detect tool_use blocks
            if (data.type === 'content_block_start') {
                const block = data.content_block;
                if (block?.type === 'tool_use') {
                    const idx = data.index ?? toolCallAccum.length;
                    toolCallAccum[idx] = {
                        id: block.id || '',
                        type: 'function',
                        function: { name: block.name || '', arguments: '' },
                    };
                }
                continue;
            }

            if (data.type === 'content_block_delta') {
                const delta = data.delta;
                if (!delta) continue;

                if (delta.type === 'text_delta' && typeof delta.text === 'string') {
                    fullText += delta.text;
                    yield { type: 'text_delta', text: delta.text };
                } else if (delta.type === 'thinking_delta' && typeof delta.thinking === 'string') {
                    yield { type: 'thinking_delta', thinking: delta.thinking };
                } else if (delta.type === 'input_json_delta') {
                    const idx = data.index ?? 0;
                    if (toolCallAccum[idx]) {
                        toolCallAccum[idx].function.arguments += delta.partial_json || '';
                    }
                }
                continue;
            }

            // content_block_stop: emit tool call delta
            if (data.type === 'content_block_stop') {
                const idx = data.index;
                if (idx !== undefined && toolCallAccum[idx]) {
                    yield {
                        type: 'tool_calls_delta',
                        toolCalls: [{ index: idx, ...toolCallAccum[idx] }],
                    };
                }
                continue;
            }

            // message_delta: stop reason
            if (data.type === 'message_delta') {
                if (data.delta?.stop_reason) {
                    const reason = data.delta.stop_reason;
                    stopReason = reason === 'end_turn' ? 'stop' : reason === 'tool_use' ? 'tool_calls' : reason;
                }
                if (data.usage && usage) {
                    // Merge output usage — keep Anthropic's output_tokens AND add OpenAI-style fields
                    Object.assign(usage, data.usage);
                    if (data.usage.output_tokens !== undefined) {
                        usage.completion_tokens = data.usage.output_tokens;
                        usage.total_tokens = (usage.input_tokens || 0) + data.usage.output_tokens;
                    }
                }
                continue;
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
        stopReason: stopReason || (toolCalls.length > 0 ? 'tool_calls' : 'stop'),
    };
}
