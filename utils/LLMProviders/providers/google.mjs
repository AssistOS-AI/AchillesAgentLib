import { toGeminiPayload } from '../messageAdapters/googleGemini.mjs';

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
        const errorBody = await response.text();
        throw new Error(`Google Generative API Error (${response.status}): ${errorBody}`);
    }

    const responseJSON = await response.json();
    if (responseJSON.error) {
        throw new Error(JSON.stringify(responseJSON.error));
    }

    return responseJSON.candidates?.[0]?.content?.parts?.[0]?.text;
}
