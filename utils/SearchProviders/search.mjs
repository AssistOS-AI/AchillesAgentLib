import { callLLM } from '../LLMClient.mjs';
import { getProvider } from '../LLMProviders/providerRegistry.mjs';

const PROVIDER_MODEL_MAP = {
    'google-ai-mode': 'headless-google-ai-mode',
    'gemini-search': 'search-gemini',
};

function resolveSearchModel(options) {
    if (options.model) return options.model;
    if (options.provider) {
        const mapped = PROVIDER_MODEL_MAP[options.provider];
        if (mapped) return mapped;
        return `search-${options.provider}`;
    }
    return null;
}

export async function callSearch(queryOrMessages, options = {}) {
    const model = resolveSearchModel(options);
    if (!model) {
        throw new Error(
            'callSearch requires options.model or options.provider. ' +
            'Example: callSearch("query", { provider: "tavily" }) or ' +
            'callSearch("query", { model: "search-tavily" })'
        );
    }

    const providerKey = options.providerKey || 'soul_gateway';
    const provider = getProvider(providerKey);
    if (!provider) {
        throw new Error(
            `Search provider "${providerKey}" is not configured. ` +
            'Set PLOINKY_AGENT_API_KEY and SOUL_GATEWAY_URL to route ' +
            'search calls through Soul Gateway, or pass an explicit ' +
            'options.providerKey for a directly configured OpenAI-compatible provider.'
        );
    }

    const query = typeof queryOrMessages === 'string'
        ? queryOrMessages
        : extractSearchQuery(queryOrMessages);

    const { provider: _p, model: _m, providerKey: _pk, ...passthrough } = options;

    return callLLM([], query, {
        model,
        providerKey,
        ...passthrough,
    });
}

export function extractSearchQuery(messages) {
    if (!Array.isArray(messages)) return '';
    for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === 'user') {
            const content = messages[i].content;
            if (typeof content === 'string') return content;
            if (Array.isArray(content)) {
                const text = content.find((p) => p.type === 'text');
                return text?.text || '';
            }
        }
    }
    return '';
}
