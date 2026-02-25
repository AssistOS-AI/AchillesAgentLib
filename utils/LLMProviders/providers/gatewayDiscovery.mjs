/**
 * Gateway Auto-Discovery
 *
 * Fetches available models from a Soul Gateway `/v1/models` endpoint
 * and converts them into achillesAgentLib model descriptors.
 */

/**
 * Derive the `/v1/models` URL from a provider's baseURL.
 * Strips trailing path segments like `/v1/chat/completions`.
 */
function deriveModelsURL(baseURL) {
    return baseURL
        .replace(/\/chat\/completions\/?$/, '/models')
        .replace(/\/messages\/?$/, '/models')
        .replace(/\/completions\/?$/, '/models')
        .replace(/\/responses\/?$/, '/models');
}

/**
 * Fetch models from a Soul Gateway endpoint and return them as model descriptors.
 *
 * @param {object} providerConfig - Normalized provider config { providerKey, baseURL, apiKeyEnv, ... }
 * @returns {Promise<{ models: Array, issues: { errors: string[], warnings: string[] } }>}
 */
export async function discoverModels(providerConfig) {
    const issues = { errors: [], warnings: [] };
    const { providerKey, baseURL, apiKeyEnv } = providerConfig;

    if (!baseURL) {
        issues.warnings.push(`Gateway discovery: provider "${providerKey}" has no baseURL.`);
        return { models: [], issues };
    }

    const modelsURL = deriveModelsURL(baseURL);
    const apiKey = apiKeyEnv ? process.env[apiKeyEnv] : null;

    if (!apiKey) {
        issues.warnings.push(`Gateway discovery: no API key for provider "${providerKey}" (env: ${apiKeyEnv}).`);
        return { models: [], issues };
    }

    try {
        const resp = await fetch(modelsURL, {
            headers: { 'Authorization': `Bearer ${apiKey}` },
            signal: AbortSignal.timeout(10_000),
        });

        if (!resp.ok) {
            issues.warnings.push(`Gateway discovery: ${modelsURL} returned ${resp.status}.`);
            return { models: [], issues };
        }

        const data = await resp.json();
        const rawModels = Array.isArray(data) ? data : (data.data || []);

        const models = rawModels
            .filter(m => m.id)
            .map(m => ({
                name: m.id,
                providerKey,
                mode: m.mode || 'deep',
                inputPrice: parseFloat(m.input_price) || 0,
                outputPrice: parseFloat(m.output_price) || 0,
                context: m.context_window || null,
                sortOrder: m.sort_order ?? 100,
                fromGateway: true,
            }))
            .sort((a, b) => a.sortOrder - b.sortOrder);

        return { models, issues };
    } catch (err) {
        issues.warnings.push(`Gateway discovery: failed to fetch from ${modelsURL}: ${err.message}`);
        return { models: [], issues };
    }
}
