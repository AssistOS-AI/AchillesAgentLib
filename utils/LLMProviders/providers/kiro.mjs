import { parseSSEStream } from './sseParser.mjs';

function resolveKiroURL(baseURL) {
    const trimmed = (baseURL || 'https://api.kiro.dev').replace(/\/+$/, '');
    if (trimmed.endsWith('/v1/converse-stream')) {
        return trimmed;
    }
    return `${trimmed}/v1/converse-stream`;
}

function mapRoleToKiro(role) {
    switch (role) {
        case 'assistant': return 'assistant';
        case 'user': return 'user';
        case 'tool': return 'user';
        default: return 'user';
    }
}

function convertContent(msg) {
    if (typeof msg.content === 'string') {
        return [{ text: msg.content }];
    }

    if (Array.isArray(msg.content)) {
        return msg.content.map((part) => {
            if (part.type === 'text') return { text: part.text || '' };
            if (part.type === 'image_url') {
                return { image: { source: { url: part.image_url?.url || '' } } };
            }
            return { text: JSON.stringify(part) };
        });
    }

    if (msg.role === 'tool') {
        return [{
            toolResult: {
                toolUseId: msg.tool_call_id,
                content: [{ text: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content ?? '') }],
            },
        }];
    }

    return [{ text: String(msg.content || '') }];
}

function convertToolDef(tool) {
    const fn = tool.function || tool;
    return {
        toolSpec: {
            name: fn.name,
            description: fn.description || '',
            inputSchema: {
                json: fn.parameters || { type: 'object', properties: {} },
            },
        },
    };
}

function buildKiroRequest(chatContext, options) {
    const turns = [];
    let systemInstruction = null;

    for (const msg of chatContext || []) {
        if (msg.role === 'system') {
            systemInstruction = typeof msg.content === 'string'
                ? msg.content
                : Array.isArray(msg.content)
                    ? msg.content.filter((part) => part.type === 'text').map((part) => part.text || '').join('\n')
                    : '';
            continue;
        }

        turns.push({
            role: mapRoleToKiro(msg.role),
            content: convertContent(msg),
        });
    }

    const body = {
        modelId: options.model,
        conversationState: { turns },
        inferenceConfig: {},
    };

    if (systemInstruction) {
        body.conversationState.systemInstruction = systemInstruction;
    }

    const params = options.params || {};
    if (params.max_tokens != null) body.inferenceConfig.maxTokens = params.max_tokens;
    if (params.temperature != null) body.inferenceConfig.temperature = params.temperature;
    if (params.top_p != null) body.inferenceConfig.topP = params.top_p;
    if (params.stop != null) {
        body.inferenceConfig.stopSequences = Array.isArray(params.stop) ? params.stop : [params.stop];
    }
    if (params.tools && params.tools.length > 0) {
        body.toolConfig = { tools: params.tools.map(convertToolDef) };
    }
    if (params.region) {
        body.region = params.region;
    }

    for (const [key, value] of Object.entries(params)) {
        if (!(key in body.inferenceConfig) && !['max_tokens', 'temperature', 'top_p', 'stop', 'tools', 'region'].includes(key)) {
            body[key] = value;
        }
    }

    return body;
}

function buildHeaders(apiKey, headers = {}) {
    const built = {
        'Content-Type': 'application/json',
        Accept: 'application/vnd.amazon.eventstream',
        ...headers,
    };
    if (!built.Authorization && apiKey) {
        built.Authorization = `Bearer ${apiKey}`;
    }
    return built;
}

function parseBinaryFrame(buffer) {
    if (!buffer || buffer.length < 16) return null;

    const totalLength = buffer.readUInt32BE(0);
    const headersLength = buffer.readUInt32BE(4);
    const headersStart = 12;
    const headersEnd = headersStart + headersLength;
    const payloadStart = headersEnd;
    const payloadEnd = totalLength - 4;

    const headers = {};
    let pos = headersStart;
    while (pos < headersEnd) {
        const nameLen = buffer.readUInt8(pos);
        pos += 1;
        const name = buffer.toString('utf8', pos, pos + nameLen);
        pos += nameLen;
        const headerType = buffer.readUInt8(pos);
        pos += 1;

        if (headerType === 7) {
            const valueLength = buffer.readUInt16BE(pos);
            pos += 2;
            headers[name] = buffer.toString('utf8', pos, pos + valueLength);
            pos += valueLength;
        } else {
            break;
        }
    }

    const payloadBytes = buffer.subarray(payloadStart, payloadEnd);
    let payload = null;
    if (payloadBytes.length > 0) {
        try {
            payload = JSON.parse(payloadBytes.toString('utf8'));
        } catch {
            payload = payloadBytes.toString('utf8');
        }
    }

    return { headers, payload };
}

function normalizeFrame(rawChunk, state) {
    if (!state.initialized) {
        state.initialized = true;
        state.model = null;
        state.toolIndex = 0;
    }

    const event = rawChunk.payload || rawChunk;
    const eventType = rawChunk.headers?.[':event-type'] || event.type || event.event;

    switch (eventType) {
        case 'messageStart':
        case 'message_start': {
            state.model = event.model || event.modelId || state.model;
            return [{ type: 'message_start', role: event.role || 'assistant' }];
        }

        case 'contentBlockStart':
        case 'content_block_start': {
            const block = event.contentBlock || event.content_block || {};
            if (block.type === 'tool_use' || block.toolUse) {
                const toolUse = block.toolUse || block;
                const idx = state.toolIndex++;
                return [{
                    type: 'tool_calls_delta',
                    toolCalls: [{
                        index: idx,
                        id: toolUse.toolUseId || toolUse.id,
                        type: 'function',
                        function: { name: toolUse.name, arguments: '' },
                    }],
                }];
            }
            return [];
        }

        case 'contentBlockDelta':
        case 'content_block_delta': {
            const delta = event.delta || {};
            if (delta.type === 'text_delta' || delta.text != null) {
                return [{ type: 'text_delta', text: delta.text || '' }];
            }

            if (delta.type === 'tool_use' || delta.toolUse) {
                const toolUse = delta.toolUse || delta;
                return [{
                    type: 'tool_calls_delta',
                    toolCalls: [{
                        index: Math.max(0, state.toolIndex - 1),
                        function: { arguments: toolUse.input || '' },
                    }],
                }];
            }
            return [];
        }

        case 'metadata': {
            const usage = event.usage || event.metrics;
            if (!usage) return [];
            return [{
                type: 'usage',
                input_tokens: usage.inputTokens || usage.input_tokens || 0,
                output_tokens: usage.outputTokens || usage.output_tokens || 0,
                total_tokens: (usage.inputTokens || usage.input_tokens || 0) + (usage.outputTokens || usage.output_tokens || 0),
            }];
        }

        case 'messageStop':
        case 'message_stop': {
            const reason = event.stopReason || event.stop_reason || 'stop';
            return [{ type: 'done', fullText: '', usage: null, stopReason: mapStopReason(reason) }];
        }

        case 'error':
        case 'exception': {
            return [{
                type: 'error',
                error: new Error(event.message || event.error?.message || 'Kiro error'),
            }];
        }

        default:
            return [];
    }
}

function mapStopReason(reason) {
    switch (reason) {
        case 'end_turn': return 'stop';
        case 'max_tokens': return 'length';
        case 'tool_use': return 'tool_calls';
        default: return reason || 'stop';
    }
}

export async function callLLM(chatContext, options) {
    let fullText = '';
    for await (const chunk of callLLMStreaming(chatContext, options)) {
        if (chunk.type === 'text_delta') {
            fullText += chunk.text || '';
        } else if (chunk.type === 'error') {
            throw chunk.error;
        }
    }
    return fullText;
}

export async function* callLLMStreaming(chatContext, options) {
    if (!options || typeof options !== 'object') {
        throw new Error('Kiro provider requires invocation options.');
    }

    const { model, apiKey, baseURL, signal, headers = {} } = options;
    if (!model) throw new Error('Kiro provider requires a model name.');
    if (!apiKey && !headers.Authorization) throw new Error('Kiro provider requires a token or Authorization header.');

    const url = resolveKiroURL(baseURL);
    const requestBody = buildKiroRequest(chatContext, options);
    const response = await fetch(url, {
        method: 'POST',
        headers: buildHeaders(apiKey, headers),
        body: JSON.stringify(requestBody),
        signal,
    });

    if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Kiro API Error (${response.status}): ${errorBody}`);
    }

    const contentType = response.headers.get('content-type') || '';
    const state = {};

    if (contentType.includes('application/vnd.amazon.eventstream')) {
        const reader = response.body.getReader();
        let buffer = Buffer.alloc(0);

        try {
            while (true) {
                const { value, done } = await reader.read();
                if (done) break;

                buffer = Buffer.concat([buffer, Buffer.from(value)]);

                while (buffer.length >= 12) {
                    const totalLength = buffer.readUInt32BE(0);
                    if (buffer.length < totalLength) break;

                    const frameBytes = buffer.subarray(0, totalLength);
                    buffer = buffer.subarray(totalLength);

                    const frame = parseBinaryFrame(frameBytes);
                    if (!frame) continue;

                    for (const chunk of normalizeFrame(frame, state)) {
                        yield chunk;
                    }
                }
            }
        } finally {
            reader.releaseLock();
        }
        return;
    }

    for await (const frame of parseSSEStream(response.body, { doneSentinel: null })) {
        const data = frame.parsedData;
        if (!data) continue;
        for (const chunk of normalizeFrame(data, state)) {
            yield chunk;
        }
    }
}
