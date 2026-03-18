import { toOpenAIChatMessages } from '../messageAdapters/openAIChat.mjs';

/**
 * Ollama native API provider (/api/chat).
 * Supports `think: false` to disable Qwen3's reasoning mode,
 * which the OpenAI-compatible endpoint does not expose.
 */
export async function callLLM(chatContext, options) {
    if (!options || typeof options !== 'object') {
        throw new Error('Ollama provider requires invocation options.');
    }

    const { model, baseURL, signal, params } = options;
    if (!model) throw new Error('Ollama provider requires a model name.');
    if (!baseURL) throw new Error('Ollama provider requires a baseURL.');

    // Map config model name to actual Ollama model name
    // e.g. "qwen3-14b-nothink" → "qwen3:14b"
    const ollamaModel = model.replace(/-nothink$/, '').replace(/-(\d+[bB])$/, ':$1');

    const messages = toOpenAIChatMessages(chatContext);
    const payload = {
        model: ollamaModel,
        messages,
        stream: false,
        think: false,
    };

    if (params && typeof params === 'object') {
        Object.assign(payload, params);
    }

    const response = await fetch(baseURL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal,
    });

    if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Ollama API Error (${response.status}): ${errorBody}`);
    }

    const data = await response.json();
    if (data.error) {
        throw new Error(`Ollama API Error: ${JSON.stringify(data.error)}`);
    }

    return data.message?.content;
}
