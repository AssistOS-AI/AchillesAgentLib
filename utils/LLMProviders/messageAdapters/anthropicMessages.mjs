const ROLE_MAP = {
    human: 'user',
    user: 'user',
    assistant: 'assistant',
    model: 'assistant',
};

function normalizeRole(rawRole) {
    const role = typeof rawRole === 'string' ? rawRole.trim().toLowerCase() : '';
    return ROLE_MAP[role] || 'user';
}

function extractContent(entry) {
    if (!entry || typeof entry !== 'object') {
        return '';
    }
    if (typeof entry.content === 'string') {
        return entry.content;
    }
    if (typeof entry.message === 'string') {
        return entry.message;
    }
    if (typeof entry.text === 'string') {
        return entry.text;
    }
    if (Array.isArray(entry.content)) {
        return entry.content
            .filter(chunk => chunk?.type === 'text' || chunk?.type === 'input_text')
            .map(chunk => chunk.text || '')
            .join('\n')
            .trim();
    }
    return '';
}

function isSystem(entry) {
    const role = typeof entry?.role === 'string' ? entry.role.trim().toLowerCase() : '';
    return role === 'system';
}

export function toAnthropicMessages(history = []) {
    const messages = [];
    let system = null;

    if (!Array.isArray(history)) {
        return { system: null, messages };
    }

    for (const entry of history) {
        if (isSystem(entry)) {
            const content = extractContent(entry);
            if (content) {
                system = system ? `${system}\n${content}` : content;
            }
            continue;
        }

        if (typeof entry === 'string') {
            messages.push({ role: 'user', content: [{ type: 'text', text: entry }] });
            continue;
        }

        const content = extractContent(entry);
        if (!content) {
            continue;
        }

        const role = normalizeRole(entry.role || entry.author);
        messages.push(convertMessage({ ...entry, role }, content));
    }

    return { system, messages };
}

function convertMessage(entry, fallbackContent = '') {
    if (entry.role === 'tool') {
        return {
            role: 'user',
            content: [{
                type: 'tool_result',
                tool_use_id: entry.tool_call_id,
                content: typeof entry.content === 'string' ? entry.content : JSON.stringify(entry.content ?? ''),
            }],
        };
    }

    const result = { role: normalizeRole(entry.role || entry.author) };
    const parts = [];

    if (Array.isArray(entry.content)) {
        for (const part of entry.content) {
            if (!part || typeof part !== 'object') continue;
            if (part.type === 'text' || part.type === 'input_text') {
                parts.push({ type: 'text', text: part.text || '' });
                continue;
            }
            if (part.type === 'image_url') {
                const url = part.image_url?.url || '';
                if (url.startsWith('data:')) {
                    const match = url.match(/^data:([^;]+);base64,(.+)$/);
                    if (match) {
                        parts.push({
                            type: 'image',
                            source: { type: 'base64', media_type: match[1], data: match[2] },
                        });
                    }
                } else if (url) {
                    parts.push({ type: 'image', source: { type: 'url', url } });
                }
            }
        }
    } else if (fallbackContent) {
        parts.push({ type: 'text', text: fallbackContent });
    }

    if (Array.isArray(entry.tool_calls)) {
        for (const toolCall of entry.tool_calls) {
            parts.push({
                type: 'tool_use',
                id: toolCall.id,
                name: toolCall.function?.name || toolCall.name || '',
                input: safeParseJson(toolCall.function?.arguments || toolCall.arguments || '{}'),
            });
        }
    }

    result.content = parts.length > 0 ? parts : [{ type: 'text', text: fallbackContent }];
    return result;
}

function safeParseJson(value) {
    try {
        return JSON.parse(value);
    } catch {
        return {};
    }
}
