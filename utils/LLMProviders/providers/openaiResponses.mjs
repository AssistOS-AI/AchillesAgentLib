import { toOpenAIChatMessages } from '../messageAdapters/openAIChat.mjs';
import { parseSSEStream } from './sseParser.mjs';

/**
 * OpenAI Responses API provider.
 *
 * Used by models that require the /v1/responses endpoint (e.g. gpt-5.2-codex)
 * instead of the /v1/chat/completions endpoint.
 *
 * Key differences from the Chat Completions API:
 *  - Endpoint: POST /v1/responses
 *  - Payload uses `input` (array of message objects) instead of `messages`
 *  - Role mapping: "system" -> "developer", "user" stays "user",
 *    "assistant" stays "assistant"
 *  - Response shape: output[] -> message -> content[] -> output_text -> text
 */

const ROLE_MAP = {
    system: 'developer',
    user: 'user',
    assistant: 'assistant',
};

/**
 * Convert standard OpenAI chat messages into Responses API input items.
 * The Responses API uses "developer" instead of "system".
 */
function toResponsesInput(chatContext) {
    const messages = toOpenAIChatMessages(chatContext);
    return messages.map((msg) => ({
        role: ROLE_MAP[msg.role] || 'user',
        content: Array.isArray(msg.content)
            ? msg.content.map((part) => {
                if (part.type === 'text') return { type: 'input_text', text: part.text || '' };
                if (part.type === 'image_url') return { type: 'input_image', image_url: part.image_url?.url || '' };
                return part;
            })
            : msg.content,
    }));
}

function convertTools(tools) {
    return (tools || []).map((tool) => {
        const fn = tool.function || tool;
        return {
            type: 'function',
            name: fn.name,
            description: fn.description || '',
            parameters: fn.parameters || { type: 'object', properties: {} },
        };
    });
}

/**
 * Extract text from the Responses API output structure.
 * The output is an array of items; each message item contains a content array
 * with entries of type "output_text".
 */
function extractOutputText(output) {
    if (!Array.isArray(output)) {
        return '';
    }

    const textParts = [];
    for (const item of output) {
        if (item.type !== 'message') continue;
        if (!Array.isArray(item.content)) continue;
        for (const block of item.content) {
            if (block.type === 'output_text' && typeof block.text === 'string') {
                textParts.push(block.text);
            }
        }
    }
    return textParts.join('\n').trim();
}

function deriveProviderLabel(baseURL) {
    const match = baseURL.match(/https?:\/\/api\.([^/]+)\/?/i);
    return match?.[1] || 'OpenAI';
}

function resolveResponsesURL(baseURL) {
    const trimmed = (baseURL || '').replace(/\/+$/, '');
    if (!trimmed) {
        return 'https://api.openai.com/v1/responses';
    }

    if (trimmed.endsWith('/responses')) {
        return trimmed;
    }

    if (trimmed.endsWith('/v1')) {
        return `${trimmed}/responses`;
    }

    return `${trimmed}/v1/responses`;
}

export async function callLLM(chatContext, options) {
    if (!options || typeof options !== 'object') {
        throw new Error('OpenAI Responses provider requires invocation options.');
    }

    const { model, apiKey, baseURL, signal, params, headers } = options;
    const providerLabel = deriveProviderLabel(baseURL);
    if (!model) {
        throw new Error(`${providerLabel} Responses provider requires a model name.`);
    }
    if (!apiKey) {
        throw new Error(`${providerLabel} Responses provider requires an API key.`);
    }
    if (!baseURL) {
        throw new Error(`${providerLabel} Responses provider requires a baseURL.`);
    }

    const input = toResponsesInput(chatContext);
    const payload = {
        model,
        input,
    };

    if (params && typeof params === 'object') {
        Object.assign(payload, params);
        if (Array.isArray(params.tools)) {
            payload.tools = convertTools(params.tools);
        }
    }

    const response = await fetch(resolveResponsesURL(baseURL), {
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
        throw new Error(`${providerLabel} Responses API Error (${response.status}): ${errorBody}`);
    }

    const data = await response.json();
    if (data.error) {
        throw new Error(`${providerLabel} Responses API Error: ${JSON.stringify(data.error)}`);
    }

    // Try the convenience property first, fall back to manual extraction
    if (typeof data.output_text === 'string') {
        return data.output_text;
    }

    return extractOutputText(data.output);
}

/**
 * Streaming variant of callLLM for the OpenAI Responses API.
 *
 * Sets `stream: true`.  The Responses API emits typed SSE events:
 *   - `response.output_text.delta` with `{ delta: string }` — text chunk
 *   - `response.completed` — final event
 *   - `error` — API error
 *
 * @param {Array}  chatContext - Conversation history.
 * @param {object} options     - Same shape as callLLM options.
 * @yields {StreamChunk}
 */
export async function* callLLMStreaming(chatContext, options) {
    if (!options || typeof options !== 'object') {
        throw new Error('OpenAI Responses provider requires invocation options.');
    }

    const { model, apiKey, baseURL, signal, params, headers } = options;
    const providerLabel = deriveProviderLabel(baseURL);
    if (!model) throw new Error(`${providerLabel} Responses provider requires a model name.`);
    if (!apiKey) throw new Error(`${providerLabel} Responses provider requires an API key.`);
    if (!baseURL) throw new Error(`${providerLabel} Responses provider requires a baseURL.`);

    const input = toResponsesInput(chatContext);
    const payload = {
        model,
        input,
        stream: true,
    };

    if (params && typeof params === 'object') {
        Object.assign(payload, params);
        if (Array.isArray(params.tools)) {
            payload.tools = convertTools(params.tools);
        }
    }

    const response = await fetch(resolveResponsesURL(baseURL), {
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
        throw new Error(`${providerLabel} Responses API Error (${response.status}): ${errorBody}`);
    }

    let fullText = '';
    let usage = null;

    try {
        for await (const frame of parseSSEStream(response.body, { doneSentinel: null })) {
            const data = frame.parsedData;
            if (!data) continue;

            // The Responses API uses the SSE event field for event type
            const eventType = frame.event || data.type;

            if (eventType === 'error') {
                const errPayload = data.error || data;
                yield { type: 'error', error: new Error(`${providerLabel} Responses API Error: ${JSON.stringify(errPayload)}`) };
                return;
            }

            if (data.usage || data.response?.usage) {
                usage = data.usage || data.response?.usage;
            }

            if (eventType === 'response.output_text.delta' && typeof data.delta === 'string') {
                fullText += data.delta;
                yield { type: 'text_delta', text: data.delta };
            }

            if (eventType === 'response.completed') {
                break;
            }
        }
    } catch (err) {
        yield { type: 'error', error: err };
        return;
    }

    yield { type: 'done', fullText, usage };
}
