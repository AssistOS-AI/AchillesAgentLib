import { toOpenAIChatMessages } from '../messageAdapters/openAIChat.mjs';

function deriveProviderLabel(baseURL) {
    const match = baseURL.match(/https?:\/\/api\.([^/]+)\/v1\//i);
    return match?.[1] || 'OpenAI';
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
        throw new Error(`${providerLabel} Completions API Error (${response.status}): ${errorBody}`);
    }

    const data = await response.json();
    if (data.error) {
        throw new Error(`${providerLabel} Completions API Error: ${JSON.stringify(data.error)}`);
    }
    return data.choices?.[0]?.text?.trim() ?? '';
}
