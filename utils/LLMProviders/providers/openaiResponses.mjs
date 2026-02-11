import { toOpenAIChatMessages } from '../messageAdapters/openAIChat.mjs';

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
        content: msg.content,
    }));
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
    const match = baseURL.match(/https?:\/\/api\.([^/]+)\/v1\//i);
    return match?.[1] || 'OpenAI';
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
