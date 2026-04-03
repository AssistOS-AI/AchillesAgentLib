import { toOpenAIChatMessages } from '../messageAdapters/openAIChat.mjs';
import { parseSSEStream } from './sseParser.mjs';

function deriveProviderLabel(baseURL) {
    const match = baseURL.match(/https?:\/\/api\.([^/]+)\/?/i);
    return match?.[1] || 'OpenAI';
}

function resolveCompletionsURL(baseURL) {
    const trimmed = (baseURL || '').replace(/\/+$/, '');
    if (!trimmed) {
        return 'https://api.openai.com/v1/completions';
    }

    if (trimmed.endsWith('/completions')) {
        return trimmed;
    }

    if (trimmed.endsWith('/v1')) {
        return `${trimmed}/completions`;
    }

    return `${trimmed}/v1/completions`;
}

/**
 * Converts chat-style messages into a single prompt string for the
 * OpenAI /v1/completions endpoint (used by codex models).
 *
 * Format:
 *   system: content goes first, then alternating user/assistant turns.
 */
function messagesToPrompt(chatContext) {
    const messages = toOpenAIChatMessages(chatContext);
    if (!messages.length) {
        return '';
    }

    const parts = [];
    for (const msg of messages) {
        switch (msg.role) {
            case 'system':
                parts.push(msg.content);
                break;
            case 'user':
                parts.push(`\nHuman: ${msg.content}`);
                break;
            case 'assistant':
                parts.push(`\nAssistant: ${msg.content}`);
                break;
            default:
                parts.push(`\n${msg.content}`);
        }
    }
    // Signal the model to generate an assistant response
    parts.push('\nAssistant:');
    return parts.join('\n');
}

export async function callLLM(chatContext, options) {
    if (!options || typeof options !== 'object') {
        throw new Error('OpenAI Completions provider requires invocation options.');
    }

    const { model, apiKey, baseURL, signal, params, headers } = options;
    const providerLabel = deriveProviderLabel(baseURL);
    if (!model) {
        throw new Error(`${providerLabel} Completions provider requires a model name.`);
    }
    if (!apiKey) {
        throw new Error(`${providerLabel} Completions provider requires an API key.`);
    }
    if (!baseURL) {
        throw new Error(`${providerLabel} Completions provider requires a baseURL.`);
    }

    const prompt = messagesToPrompt(chatContext);
    const payload = {
        model,
        prompt,
        max_tokens: 16384,
    };

    if (params && typeof params === 'object') {
        Object.assign(payload, params);
    }

    const response = await fetch(resolveCompletionsURL(baseURL), {
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
        throw new Error(`${providerLabel} Completions API Error (${response.status}): ${errorBody}`);
    }

    const data = await response.json();
    if (data.error) {
        throw new Error(`${providerLabel} Completions API Error: ${JSON.stringify(data.error)}`);
    }
    return data.choices?.[0]?.text?.trim() ?? '';
}

/**
 * Streaming variant of callLLM for the OpenAI legacy Completions API.
 *
 * Sets `stream: true`, parses SSE chunks where each `data:` line contains JSON
 * with `choices[0].text`.  Final frame is `data: [DONE]`.
 *
 * @param {Array}  chatContext - Conversation history.
 * @param {object} options     - Same shape as callLLM options.
 * @yields {StreamChunk}
 */
export async function* callLLMStreaming(chatContext, options) {
    if (!options || typeof options !== 'object') {
        throw new Error('OpenAI Completions provider requires invocation options.');
    }

    const { model, apiKey, baseURL, signal, params, headers } = options;
    const providerLabel = deriveProviderLabel(baseURL);
    if (!model) throw new Error(`${providerLabel} Completions provider requires a model name.`);
    if (!apiKey) throw new Error(`${providerLabel} Completions provider requires an API key.`);
    if (!baseURL) throw new Error(`${providerLabel} Completions provider requires a baseURL.`);

    const prompt = messagesToPrompt(chatContext);
    const payload = {
        model,
        prompt,
        max_tokens: 16384,
        stream: true,
    };

    if (params && typeof params === 'object') {
        Object.assign(payload, params);
    }

    const response = await fetch(resolveCompletionsURL(baseURL), {
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
        throw new Error(`${providerLabel} Completions API Error (${response.status}): ${errorBody}`);
    }

    let fullText = '';
    let usage = null;

    try {
        for await (const frame of parseSSEStream(response.body)) {
            const data = frame.parsedData;
            if (!data) continue;

            if (data.error) {
                yield { type: 'error', error: new Error(`${providerLabel} Completions API Error: ${JSON.stringify(data.error)}`) };
                return;
            }

            if (data.usage) {
                usage = data.usage;
            }

            const text = data.choices?.[0]?.text;
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
