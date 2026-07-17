import { STATUS_CODES } from 'node:http';

import { toOpenAIChatMessages } from '../messageAdapters/openAIChat.mjs';
import { parseSSEStream } from './sseParser.mjs';

const RESPONSES_API_MODELS = new Set([
    'o1-preview', 'o1-mini', 'o3-mini',
    'gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano',
]);

const VSCODE_USER_AGENT = 'GitHubCopilotChat/0.24.2024122001';
const COPILOT_INTEGRATION_ID = 'vscode-chat';

function resolveBaseURL(baseURL) {
    return (baseURL || 'https://api.githubcopilot.com').replace(/\/+$/, '');
}

function resolveEndpoint(model, params = {}) {
    if (params.force_endpoint === 'responses') return 'responses';
    if (params.force_endpoint === 'completions') return 'completions';
    return RESPONSES_API_MODELS.has(model) ? 'responses' : 'completions';
}

function buildHeaders(apiKey, headers = {}) {
    return {
        Authorization: headers.Authorization || `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': headers['User-Agent'] || VSCODE_USER_AGENT,
        'Copilot-Integration-Id': headers['Copilot-Integration-Id'] || COPILOT_INTEGRATION_ID,
        Editor: headers.Editor || 'vscode/1.96.2',
        'Editor-Plugin-Version': headers['Editor-Plugin-Version'] || 'copilot-chat/0.24.2024122001',
        'Editor-Version': headers['Editor-Version'] || 'vscode/1.96.2',
        ...headers,
    };
}

function toCompletionsPayload(chatContext, model, params = {}) {
    const payload = {
        model,
        messages: toOpenAIChatMessages(chatContext),
    };

    if (params.stream !== undefined) payload.stream = params.stream;
    if (params.max_tokens != null) payload.max_tokens = params.max_tokens;
    if (params.temperature != null) payload.temperature = params.temperature;
    if (params.top_p != null) payload.top_p = params.top_p;
    if (params.stop != null) payload.stop = params.stop;
    if (params.tools) payload.tools = params.tools;
    if (params.tool_choice != null) payload.tool_choice = params.tool_choice;

    for (const [key, value] of Object.entries(params)) {
        if (!(key in payload) && key !== 'force_endpoint') {
            payload[key] = value;
        }
    }

    return payload;
}

function toResponsesPayload(chatContext, model, params = {}) {
    const payload = {
        model,
        input: toOpenAIChatMessages(chatContext).map((msg) => ({
            role: msg.role,
            content: Array.isArray(msg.content)
                ? msg.content.map((part) => {
                    if (part.type === 'text') return { type: 'input_text', text: part.text || '' };
                    if (part.type === 'image_url') return { type: 'input_image', image_url: part.image_url?.url || '' };
                    return part;
                })
                : msg.content,
        })),
    };

    if (params.stream !== undefined) payload.stream = params.stream;
    if (params.max_tokens != null) payload.max_output_tokens = params.max_tokens;
    if (params.temperature != null) payload.temperature = params.temperature;
    if (params.top_p != null) payload.top_p = params.top_p;
    if (params.tools) {
        payload.tools = params.tools.map((tool) => {
            const fn = tool.function || tool;
            return {
                type: 'function',
                name: fn.name,
                description: fn.description || '',
                parameters: fn.parameters || { type: 'object', properties: {} },
            };
        });
    }

    for (const [key, value] of Object.entries(params)) {
        if (!(key in payload) && key !== 'force_endpoint') {
            payload[key] = value;
        }
    }

    return payload;
}

function extractResponsesOutputText(response) {
    if (typeof response.output_text === 'string') {
        return response.output_text;
    }

    const parts = [];
    for (const item of response.output || []) {
        if (item.type !== 'message') continue;
        for (const content of item.content || []) {
            if (content.type === 'output_text' && typeof content.text === 'string') {
                parts.push(content.text);
            }
        }
    }
    return parts.join('\n').trim();
}

export async function callLLM(chatContext, options) {
    if (!options || typeof options !== 'object') {
        throw new Error('Copilot provider requires invocation options.');
    }

    const { model, apiKey, baseURL, signal, params = {}, headers = {} } = options;
    if (!model) throw new Error('Copilot provider requires a model name.');
    if (!apiKey && !headers.Authorization) throw new Error('Copilot provider requires a token.');

    const endpoint = resolveEndpoint(model, params);
    const rootUrl = resolveBaseURL(baseURL);
    const requestHeaders = buildHeaders(apiKey, headers);

    const url = endpoint === 'responses'
        ? `${rootUrl}/models/${model}/responses`
        : `${rootUrl}/chat/completions`;
    const body = endpoint === 'responses'
        ? toResponsesPayload(chatContext, model, { ...params, stream: false })
        : toCompletionsPayload(chatContext, model, { ...params, stream: false });

    const response = await fetch(url, {
        method: 'POST',
        headers: requestHeaders,
        body: JSON.stringify(body),
        signal,
    });

    if (!response.ok) {
        throw new Error(`Copilot API request failed: ${response.status} - ${response.statusText || STATUS_CODES[response.status] || 'Unknown Error'}.`);
    }

    const data = await response.json();
    if (endpoint === 'responses') {
        return extractResponsesOutputText(data);
    }
    return data.choices?.[0]?.message?.content ?? '';
}

export async function* callLLMStreaming(chatContext, options) {
    if (!options || typeof options !== 'object') {
        throw new Error('Copilot provider requires invocation options.');
    }

    const { model, apiKey, baseURL, signal, params = {}, headers = {} } = options;
    if (!model) throw new Error('Copilot provider requires a model name.');
    if (!apiKey && !headers.Authorization) throw new Error('Copilot provider requires a token.');

    const endpoint = resolveEndpoint(model, params);
    const rootUrl = resolveBaseURL(baseURL);
    const requestHeaders = buildHeaders(apiKey, headers);
    const url = endpoint === 'responses'
        ? `${rootUrl}/models/${model}/responses`
        : `${rootUrl}/chat/completions`;
    const body = endpoint === 'responses'
        ? toResponsesPayload(chatContext, model, { ...params, stream: true })
        : toCompletionsPayload(chatContext, model, { ...params, stream: true });

    const response = await fetch(url, {
        method: 'POST',
        headers: requestHeaders,
        body: JSON.stringify(body),
        signal,
    });

    if (!response.ok) {
        throw new Error(`Copilot API request failed: ${response.status} - ${response.statusText || STATUS_CODES[response.status] || 'Unknown Error'}.`);
    }

    if (endpoint === 'responses') {
        yield* streamResponses(response.body);
        return;
    }

    yield* streamCompletions(response.body);
}

async function* streamCompletions(body) {
    let fullText = '';
    let usage = null;
    const toolCallAccum = [];
    let stopReason = null;

    for await (const frame of parseSSEStream(body)) {
        const data = frame.parsedData;
        if (!data) continue;

        if (data.error) {
            yield {
                type: 'error',
                error: new Error(`Copilot API returned an error: ${typeof data.error === 'string' ? data.error : data.error.message || 'Unknown provider error.'}`),
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

        if (typeof delta.content === 'string' && delta.content.length > 0) {
            fullText += delta.content;
            yield { type: 'text_delta', text: delta.content };
        }

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

    yield {
        type: 'done',
        fullText,
        toolCalls: toolCallAccum.filter(Boolean),
        usage,
        stopReason: stopReason || 'stop',
    };
}

async function* streamResponses(body) {
    let fullText = '';
    let usage = null;
    const toolCallAccum = [];

    for await (const frame of parseSSEStream(body, { doneSentinel: null })) {
        const data = frame.parsedData;
        if (!data) continue;

        const eventType = frame.event || data.type;

        if (eventType === 'error') {
            yield {
                type: 'error',
                error: new Error(`Copilot Responses API returned an error: ${data.error?.message || data.message || 'Unknown provider error.'}`),
            };
            return;
        }

        if (eventType === 'response.output_text.delta' && typeof data.delta === 'string') {
            fullText += data.delta;
            yield { type: 'text_delta', text: data.delta };
            continue;
        }

        if (eventType === 'response.output_item.added') {
            const item = data.item || {};
            if (item.type === 'function_call') {
                const idx = data.output_index ?? toolCallAccum.length;
                toolCallAccum[idx] = {
                    id: item.call_id || item.id || '',
                    type: 'function',
                    function: { name: item.name || '', arguments: '' },
                };
                yield {
                    type: 'tool_calls_delta',
                    toolCalls: [{
                        index: idx,
                        id: item.call_id || item.id,
                        type: 'function',
                        function: { name: item.name || '', arguments: '' },
                    }],
                };
            }
            continue;
        }

        if (eventType === 'response.function_call_arguments.delta') {
            const idx = data.output_index ?? 0;
            if (!toolCallAccum[idx]) {
                toolCallAccum[idx] = {
                    id: '',
                    type: 'function',
                    function: { name: '', arguments: '' },
                };
            }
            toolCallAccum[idx].function.arguments += data.delta || '';
            yield {
                type: 'tool_calls_delta',
                toolCalls: [{
                    index: idx,
                    function: { arguments: data.delta || '' },
                }],
            };
            continue;
        }

        if (eventType === 'response.completed') {
            usage = data.response?.usage || usage;
            break;
        }
    }

    yield {
        type: 'done',
        fullText,
        toolCalls: toolCallAccum.filter(Boolean),
        usage,
        stopReason: 'stop',
    };
}
