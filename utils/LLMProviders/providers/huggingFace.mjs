import { toOpenAIChatMessages } from '../messageAdapters/openAIChat.mjs';

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
        const errorBody = await response.text();
        if (response.status === 503) {
            throw new Error('Hugging Face model is currently loading or unavailable (503 Service Unavailable). Please try again later.');
        }
        throw new Error(`Hugging Face API Error (${response.status}): ${errorBody}`);
    }

    const data = await response.json();

    const content = data.choices?.[0]?.message?.content;
    if (content) {
        return typeof content === 'string' ? content : JSON.stringify(content);
    }

    if (data.error) {
        throw new Error(`Hugging Face API Error: ${data.error}`);
    }

    return typeof data === 'string' ? data : JSON.stringify(data);
}
