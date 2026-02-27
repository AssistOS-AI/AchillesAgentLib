/**
 * Provider Auto-Discovery
 *
 * Fetches available models from an OpenAI-compatible `/v1/models` endpoint
 * and converts them into achillesAgentLib model descriptors.
 * Works with any provider that exposes a standard models listing endpoint.
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
 * Derive the `/v1/tiers` URL from a provider's baseURL.
 */
function deriveTiersURL(baseURL) {
    return baseURL
        .replace(/\/chat\/completions\/?$/, '/tiers')
        .replace(/\/messages\/?$/, '/tiers')
        .replace(/\/completions\/?$/, '/tiers')
        .replace(/\/responses\/?$/, '/tiers');
}

/**
 * Fetch models from a provider's /v1/models endpoint and return them as model descriptors.
 *
 * @param {object} providerConfig - Normalized provider config { providerKey, baseURL, apiKeyEnv, ... }
 * @returns {Promise<{ models: Array, issues: { errors: string[], warnings: string[] } }>}
 */
export async function discoverModels(providerConfig) {
    const issues = { errors: [], warnings: [] };
    const { providerKey, baseURL, apiKeyEnv } = providerConfig;

    if (!baseURL) {
        issues.warnings.push(`Auto-discovery: provider "${providerKey}" has no baseURL.`);
        return { models: [], issues };
    }

    const modelsURL = deriveModelsURL(baseURL);
    const apiKey = apiKeyEnv ? process.env[apiKeyEnv] : null;

    if (!apiKey) {
        issues.warnings.push(`Auto-discovery: no API key for provider "${providerKey}" (env: ${apiKeyEnv}).`);
        return { models: [], issues };
    }

    try {
        const resp = await fetch(modelsURL, {
            headers: { 'Authorization': `Bearer ${apiKey}` },
            signal: AbortSignal.timeout(10_000),
        });

        if (!resp.ok) {
            issues.warnings.push(`Auto-discovery: ${modelsURL} returned ${resp.status}.`);
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
        issues.warnings.push(`Auto-discovery: failed to fetch from ${modelsURL}: ${err.message}`);
        return { models: [], issues };
    }
}

/**
 * Fetch tier definitions from a provider's /v1/tiers endpoint.
 * Returns an array of { name, models: string[], fallback: string|null }.
 * Gracefully handles 404 (provider doesn't support tiers).
 *
 * @param {object} providerConfig - Normalized provider config
 * @returns {Promise<{ tiers: Array, issues: { errors: string[], warnings: string[] } }>}
 */
export async function discoverTiers(providerConfig) {
    const issues = { errors: [], warnings: [] };
    const { providerKey, baseURL, apiKeyEnv } = providerConfig;

    if (!baseURL) {
        return { tiers: [], issues };
    }

    const tiersURL = deriveTiersURL(baseURL);
    const apiKey = apiKeyEnv ? process.env[apiKeyEnv] : null;

    if (!apiKey) {
        return { tiers: [], issues };
    }

    try {
        const resp = await fetch(tiersURL, {
            headers: { 'Authorization': `Bearer ${apiKey}` },
            signal: AbortSignal.timeout(10_000),
        });

        if (!resp.ok) {
            // 404 = provider doesn't support tiers, not an error
            if (resp.status !== 404) {
                issues.warnings.push(`Tier discovery: ${tiersURL} returned ${resp.status}.`);
            }
            return { tiers: [], issues };
        }

        const data = await resp.json();
        const rawTiers = Array.isArray(data) ? data : (data.data || []);

        const tiers = rawTiers
            .filter(t => t.name && Array.isArray(t.models))
            .map(t => ({
                name: t.name,
                models: t.models,
                fallback: t.fallback || null,
            }));

        return { tiers, issues };
    } catch (err) {
        issues.warnings.push(`Tier discovery: failed to fetch from ${tiersURL}: ${err.message}`);
        return { tiers: [], issues };
    }
}
