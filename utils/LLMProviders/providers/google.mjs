import { STATUS_CODES } from 'node:http';

import { toGeminiPayload } from '../messageAdapters/googleGemini.mjs';
import { parseSSEStream } from './sseParser.mjs';

export async function callLLM(chatContext, options) {
    if (!options || typeof options !== 'object') {
        throw new Error('Google provider requires invocation options.');
    }

    const { model, apiKey, baseURL, signal, params, headers } = options;

    if (!model) {
        throw new Error('Google provider requires a model name.');
    }
    if (!apiKey) {
        throw new Error('Google provider requires an API key.');
    }
    if (!baseURL) {
        throw new Error('Google provider requires a baseURL.');
    }

    const convertedContext = toGeminiPayload(chatContext);
    const payload = { ...convertedContext };

    if (params && typeof params === 'object') {
        const {
            temperature,
            topP,
            topK,
            maxOutputTokens,
            candidateCount,
            stopSequences,
            ...restParams
        } = params;

        const generationConfig = {};
        if (temperature !== undefined) generationConfig.temperature = temperature;
        if (topP !== undefined) generationConfig.topP = topP;
        if (topK !== undefined) generationConfig.topK = topK;
        if (maxOutputTokens !== undefined) generationConfig.maxOutputTokens = maxOutputTokens;
        if (candidateCount !== undefined) generationConfig.candidateCount = candidateCount;
        if (Array.isArray(stopSequences) && stopSequences.length) {
            generationConfig.stopSequences = stopSequences;
        }
        if (Object.keys(generationConfig).length) {
            payload.generationConfig = {
                ...(payload.generationConfig || {}),
                ...generationConfig,
            };
        }
        Object.assign(payload, restParams);
    }

    const normalizedBase = baseURL.endsWith('/') ? baseURL : `${baseURL}/`;
    const url = `${normalizedBase}${model}:generateContent?key=${apiKey}`;

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(headers || {}),
        },
        body: JSON.stringify(payload),
        signal,
    });

    if (!response.ok) {
        throw new Error(`Google Generative API request failed: ${response.status} - ${response.statusText || STATUS_CODES[response.status] || 'Unknown Error'}.`);
    }

    const responseJSON = await response.json();
    if (responseJSON.error) {
        throw new Error(`Google Generative API returned an error: ${typeof responseJSON.error === 'string' ? responseJSON.error : responseJSON.error.message || 'Unknown provider error.'}`);
    }

    return responseJSON.candidates?.[0]?.content?.parts?.[0]?.text;
}

/**
 * Streaming variant of callLLM for Google Gemini.
 *
 * Changes the endpoint from `generateContent` to `streamGenerateContent?alt=sse`.
 * The Gemini streaming API returns SSE frames where each `data:` line is a JSON
 * object with `candidates[0].content.parts[0].text`.
 *
 * @param {Array}  chatContext - Conversation history.
 * @param {object} options     - Same shape as callLLM options.
 * @yields {StreamChunk}
 */
export async function* callLLMStreaming(chatContext, options) {
    if (!options || typeof options !== 'object') {
        throw new Error('Google provider requires invocation options.');
    }

    const { model, apiKey, baseURL, signal, params, headers } = options;

    if (!model) throw new Error('Google provider requires a model name.');
    if (!apiKey) throw new Error('Google provider requires an API key.');
    if (!baseURL) throw new Error('Google provider requires a baseURL.');

    const convertedContext = toGeminiPayload(chatContext);
    const payload = { ...convertedContext };

    if (params && typeof params === 'object') {
        const {
            temperature,
            topP,
            topK,
            maxOutputTokens,
            candidateCount,
            stopSequences,
            ...restParams
        } = params;

        const generationConfig = {};
        if (temperature !== undefined) generationConfig.temperature = temperature;
        if (topP !== undefined) generationConfig.topP = topP;
        if (topK !== undefined) generationConfig.topK = topK;
        if (maxOutputTokens !== undefined) generationConfig.maxOutputTokens = maxOutputTokens;
        if (candidateCount !== undefined) generationConfig.candidateCount = candidateCount;
        if (Array.isArray(stopSequences) && stopSequences.length) {
            generationConfig.stopSequences = stopSequences;
        }
        if (Object.keys(generationConfig).length) {
            payload.generationConfig = {
                ...(payload.generationConfig || {}),
                ...generationConfig,
            };
        }
        Object.assign(payload, restParams);
    }

    const normalizedBase = baseURL.endsWith('/') ? baseURL : `${baseURL}/`;
    const url = `${normalizedBase}${model}:streamGenerateContent?alt=sse&key=${apiKey}`;

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(headers || {}),
        },
        body: JSON.stringify(payload),
        signal,
    });

    if (!response.ok) {
        throw new Error(`Google Generative API request failed: ${response.status} - ${response.statusText || STATUS_CODES[response.status] || 'Unknown Error'}.`);
    }

    let fullText = '';
    let usage = null;

    try {
        for await (const frame of parseSSEStream(response.body, { doneSentinel: null })) {
            const data = frame.parsedData;
            if (!data) continue;

            if (data.error) {
                yield {
                    type: 'error',
                    error: new Error(`Google Generative API returned an error: ${typeof data.error === 'string' ? data.error : data.error.message || 'Unknown provider error.'}`),
                };
                return;
            }

            if (data.usageMetadata) {
                usage = data.usageMetadata;
            }

            const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
            if (typeof text === 'string' && text.length > 0) {
                fullText += text;
                yield { type: 'text_delta', text };
            }
        }
    } catch (err) {
        yield { type: 'error', error: err };
        return;
    }

    yield { type: 'done', fullText, usage };
}
