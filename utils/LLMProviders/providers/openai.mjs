import { STATUS_CODES } from 'node:http';

import { toOpenAIChatMessages } from '../messageAdapters/openAIChat.mjs';
import { parseSSEStream } from './sseParser.mjs';
import {
    GENERATED_LOCAL_CHAT_PATH,
    assertNoGeneratedLocalProtectedOverrides,
    buildGeneratedLocalOperationURL,
    isVerifiedGeneratedLocalRouterDescriptor,
    refreshGeneratedLocalRouterDescriptor,
} from '../transport/generatedLocalRouterDescriptor.mjs';
import { routerHttpRequest } from '../transport/routerHttpTransport.mjs';

function deriveProviderLabel(baseURL) {
    const match = String(baseURL || '').match(/https?:\/\/api\.([^/]+)\/?/i);
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

// OpenAI-compatible vendors stream reasoning as `delta.reasoning`
// (OpenRouter) or `delta.reasoning_content` (DeepSeek-style servers).
function reasoningDeltaText(delta) {
    for (const key of ['reasoning', 'reasoning_content']) {
        const value = delta[key];
        if (typeof value === 'string' && value.length > 0) return value;
    }
    return '';
}

function buildHeaders({ apiKey, allowNoAuth = false, headers = {}, providerLabel }) {
    if (!apiKey && !allowNoAuth) {
        throw new Error(`${providerLabel} provider requires an API key.`);
    }

    return {
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        'Content-Type': 'application/json',
        ...(headers || {}),
    };
}

function generatedLocalError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
}

function validateGeneratedLocalRequest(options, { streaming = false } = {}) {
    if (!Object.hasOwn(options, 'generatedLocalDescriptor')) {
        return null;
    }
    assertNoGeneratedLocalProtectedOverrides(options, 'Generated-local direct call parameters');
    const descriptorProperty = Object.getOwnPropertyDescriptor(options, 'generatedLocalDescriptor');
    if (!descriptorProperty || !Object.hasOwn(descriptorProperty, 'value')) {
        throw generatedLocalError(
            'PLOINKY_GENERATED_LOCAL_OVERRIDE',
            'Generated-local descriptor selection must be a plain data property.'
        );
    }
    if (!isVerifiedGeneratedLocalRouterDescriptor(descriptorProperty.value)) {
        throw generatedLocalError(
            'PLOINKY_DESCRIPTOR_BRAND_INVALID',
            'Generated-local direct calls require a verified descriptor brand.'
        );
    }
    const paramsProperty = Object.getOwnPropertyDescriptor(options, 'params');
    if (paramsProperty && !Object.hasOwn(paramsProperty, 'value')) {
        throw generatedLocalError(
            'PLOINKY_GENERATED_LOCAL_OVERRIDE',
            'Generated-local request params must be a plain data property.'
        );
    }
    if (paramsProperty?.value !== undefined) {
        assertNoGeneratedLocalProtectedOverrides(paramsProperty.value, 'Generated-local request params');
    }
    const descriptor = refreshGeneratedLocalRouterDescriptor(
        descriptorProperty.value
    );
    buildGeneratedLocalOperationURL(descriptor, GENERATED_LOCAL_CHAT_PATH);
    if (streaming && descriptor.payload.localStreaming !== 'enabled') {
        throw generatedLocalError(
            'PLOINKY_LOCAL_STREAMING_NOT_CERTIFIED',
            'Generated-local streaming is not certified for this Router descriptor.'
        );
    }

    return descriptor;
}

function readGeneratedLocalCredential(descriptor) {
    // Every descriptor, mirror, origin, operation, capability, override, and
    // required request-field check runs before this generated credential lookup.
    const apiKey = process.env.PLOINKY_AGENT_API_KEY;
    if (!apiKey) {
        throw generatedLocalError(
            'PLOINKY_GENERATED_LOCAL_KEY_MISSING',
            'Generated-local provider requires its runtime credential.'
        );
    }
    return { descriptor, apiKey };
}

const FORWARDED_ERROR_HEADERS = Object.freeze([
    'retry-after',
    'x-ratelimit-limit',
    'x-ratelimit-remaining',
    'x-ratelimit-reset',
]);

function pickErrorHeaders(headers) {
    const picked = {};
    if (!headers || typeof headers.get !== 'function') return picked;
    for (const name of FORWARDED_ERROR_HEADERS) {
        const value = headers.get(name);
        if (value !== null && value !== undefined) picked[name] = String(value);
    }
    return picked;
}

// Upstream HTTP failures keep the status, parsed body, and rate-limit headers
// so gateway callers can classify retry, fallback, and quota behavior.
async function throwUpstreamResponseError(response, providerLabel) {
    let raw = '';
    try {
        raw = typeof response.text === 'function' ? await response.text() : '';
    } catch {
        raw = '';
    }
    const error = new Error(
        `${providerLabel} API request failed: ${response.status} - ${response.statusText || STATUS_CODES[response.status] || 'Unknown Error'}.`
    );
    error.status = response.status;
    try {
        error.body = raw ? JSON.parse(raw) : {};
    } catch {
        error.body = { raw: String(raw).slice(0, 2000) };
    }
    error.headers = pickErrorHeaders(response.headers);
    throw error;
}

function createPayloadError(providerLabel, payloadError, { afterOutput = false } = {}) {
    const message = typeof payloadError === 'string'
        ? payloadError
        : payloadError?.message || 'Unknown provider error.';
    const error = new Error(`${providerLabel} API returned an error: ${message}`);
    const code = Number(payloadError?.code);
    if (Number.isInteger(code) && code >= 400 && code < 600) error.status = code;
    error.body = { error: payloadError };
    error.afterOutput = afterOutput;
    return error;
}

async function throwGeneratedLocalResponseError(response, providerLabel) {
    const detail = await response.readErrorText();
    const error = new Error(
        `${providerLabel} API request failed: ${response.status} - ${response.statusText || STATUS_CODES[response.status] || 'Unknown Error'}${detail ? ` (${detail})` : ''}.`
    );
    error.status = response.status;
    error.body = detail;
    throw error;
}

export async function callLLM(chatContext, options) {
    if (!options || typeof options !== 'object') {
        throw new Error('OpenAI provider requires invocation options.');
    }

    const generatedLocalDescriptor = validateGeneratedLocalRequest(options);
    const { model, apiKey, allowNoAuth = false, baseURL, signal, params, headers } = options;
    const providerLabel = generatedLocalDescriptor ? 'Soul Gateway' : deriveProviderLabel(baseURL);
    if (!model) {
        throw new Error(`${providerLabel} provider requires a model name.`);
    }
    if (!generatedLocalDescriptor && !baseURL) {
        throw new Error(`${providerLabel} provider requires a baseURL.`);
    }
    const generatedLocal = generatedLocalDescriptor
        ? readGeneratedLocalCredential(generatedLocalDescriptor)
        : null;
    const requestHeaders = generatedLocal
        ? null
        : buildHeaders({ apiKey, allowNoAuth, headers, providerLabel });

    const convertedContext = toOpenAIChatMessages(chatContext);
    const payload = {
        model,
        messages: convertedContext,
    };

    if (params && typeof params === 'object') {
        Object.assign(payload, params);
    }
    if (generatedLocal) payload.stream = false;

    const response = generatedLocal
        ? await routerHttpRequest({
            descriptor: generatedLocal.descriptor,
            pathname: GENERATED_LOCAL_CHAT_PATH,
            method: 'POST',
            json: payload,
            bearer: generatedLocal.apiKey,
            signal,
        })
        : await fetch(resolveChatCompletionsURL(baseURL), {
            method: 'POST',
            headers: requestHeaders,
            body: JSON.stringify(payload),
            signal,
        });

    if (!response.ok) {
        if (generatedLocal) await throwGeneratedLocalResponseError(response, providerLabel);
        await throwUpstreamResponseError(response, providerLabel);
    }

    const data = await response.json();
    if (data.error) {
        throw createPayloadError(providerLabel, data.error);
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

    const generatedLocalDescriptor = validateGeneratedLocalRequest(options, { streaming: true });
    const { model, apiKey, allowNoAuth = false, baseURL, signal, params, headers } = options;
    const providerLabel = generatedLocalDescriptor ? 'Soul Gateway' : deriveProviderLabel(baseURL);
    if (!model) throw new Error(`${providerLabel} provider requires a model name.`);
    if (!generatedLocalDescriptor && !baseURL) throw new Error(`${providerLabel} provider requires a baseURL.`);
    const generatedLocal = generatedLocalDescriptor
        ? readGeneratedLocalCredential(generatedLocalDescriptor)
        : null;
    const requestHeaders = generatedLocal
        ? null
        : buildHeaders({ apiKey, allowNoAuth, headers, providerLabel });

    const convertedContext = toOpenAIChatMessages(chatContext);
    const payload = {
        model,
        messages: convertedContext,
        stream: true,
    };

    if (params && typeof params === 'object') {
        Object.assign(payload, params);
    }
    if (generatedLocal) payload.stream = true;

    const response = generatedLocal
        ? await routerHttpRequest({
            descriptor: generatedLocal.descriptor,
            pathname: GENERATED_LOCAL_CHAT_PATH,
            method: 'POST',
            json: payload,
            bearer: generatedLocal.apiKey,
            signal,
            accept: 'text/event-stream',
        })
        : await fetch(resolveChatCompletionsURL(baseURL), {
            method: 'POST',
            headers: requestHeaders,
            body: JSON.stringify(payload),
            signal,
        });

    if (!response.ok) {
        if (generatedLocal) await throwGeneratedLocalResponseError(response, providerLabel);
        await throwUpstreamResponseError(response, providerLabel);
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
                yield {
                    type: 'error',
                    error: createPayloadError(providerLabel, data.error, {
                        afterOutput: fullText.length > 0 || toolCallAccum.length > 0,
                    }),
                };
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

            // Reasoning delta: evidence that the model is working before its
            // answer starts. It is never part of the answer text.
            const reasoning = reasoningDeltaText(delta);
            if (reasoning) {
                yield { type: 'thinking_delta', thinking: reasoning };
            }

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
        if (err && typeof err === 'object') {
            err.afterOutput = fullText.length > 0 || toolCallAccum.length > 0;
        }
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
