/**
 * envConfigLoader.mjs
 * 
 * Parses environment variables to define LLM providers and models.
 * These are merged with LLMConfig.json, with env vars taking precedence.
 * 
 * Provider format:
 *   OPENAI_<PROVIDER>_URL=<base_url>       - OpenAI-compatible provider
 *   OPENAI_<PROVIDER>_KEY=<api_key>        - Direct API key
 *   OPENAI_<PROVIDER>_KEY_ENV=<env_var>    - Env var name containing key
 *   
 *   ANTHROPIC_<PROVIDER>_URL=<base_url>    - Anthropic-compatible provider
 *   ANTHROPIC_<PROVIDER>_KEY=<api_key>     - Direct API key
 *   ANTHROPIC_<PROVIDER>_KEY_ENV=<env_var> - Env var name containing key
 * 
 * Model format:
 *   LLM_MODEL_<NN>=<provider>/<model>|<mode>|<inputPrice>|<outputPrice>|<context>
 *   
 *   Examples:
 *   LLM_MODEL_01=myproxy/gpt-4-turbo|deep|5|15|128k
 *   LLM_MODEL_02=bedrock/claude-3-sonnet|fast|3|15|200k
 *   LLM_MODEL_03=myproxy/gpt-4o-mini|fast   (prices and context optional)
 * 
 * The provider/model format allows disambiguation when the same model name
 * exists across multiple providers.
 */

const API_TYPE_OPENAI = 'openai';
const API_TYPE_ANTHROPIC = 'anthropic';

const OPENAI_MODULE = './utils/LLMProviders/providers/openai.mjs';
const ANTHROPIC_MODULE = './utils/LLMProviders/providers/anthropic.mjs';

/**
 * Parse a model definition string.
 * Format: provider/model|mode|inputPrice|outputPrice|context
 * 
 * @param {string} value - The model definition string
 * @returns {object|null} Parsed model object or null if invalid
 */
function parseModelDefinition(value) {
    if (!value || typeof value !== 'string') {
        return null;
    }

    const parts = value.split('|').map(p => p.trim());
    if (parts.length < 1) {
        return null;
    }

    const providerModel = parts[0];
    const slashIdx = providerModel.indexOf('/');
    if (slashIdx === -1) {
        // No provider specified - invalid for env-defined models
        return null;
    }

    const provider = providerModel.substring(0, slashIdx).toLowerCase();
    const modelName = providerModel.substring(slashIdx + 1);

    if (!provider || !modelName) {
        return null;
    }

    const mode = parts[1]?.toLowerCase() || 'fast';
    const inputPrice = parts[2] ? parseFloat(parts[2]) : 0;
    const outputPrice = parts[3] ? parseFloat(parts[3]) : 0;
    const context = parts[4] || 'N/A';

    return {
        name: modelName,
        provider,
        providerKey: provider,
        mode: mode === 'deep' ? 'deep' : 'fast',
        inputPrice: isNaN(inputPrice) ? 0 : inputPrice,
        outputPrice: isNaN(outputPrice) ? 0 : outputPrice,
        context,
        // Store the qualified name for lookups
        qualifiedName: `${provider}/${modelName}`,
    };
}

/**
 * Extract provider definitions from environment variables.
 * Looks for patterns like OPENAI_<NAME>_URL or ANTHROPIC_<NAME>_URL
 * 
 * @returns {Map<string, object>} Map of provider name to provider config
 */
function parseProvidersFromEnv() {
    const providers = new Map();
    const providerData = new Map(); // Collect partial data before building providers

    // Patterns to match
    const urlPattern = /^(OPENAI|ANTHROPIC)_([A-Z][A-Z0-9_]*)_URL$/;
    const keyPattern = /^(OPENAI|ANTHROPIC)_([A-Z][A-Z0-9_]*)_KEY$/;
    const keyEnvPattern = /^(OPENAI|ANTHROPIC)_([A-Z][A-Z0-9_]*)_KEY_ENV$/;

    for (const [envKey, envValue] of Object.entries(process.env)) {
        if (!envValue) continue;

        let match;

        // Check for URL
        match = envKey.match(urlPattern);
        if (match) {
            const [, apiType, providerName] = match;
            const key = `${apiType}_${providerName}`;
            if (!providerData.has(key)) {
                providerData.set(key, { apiType, providerName });
            }
            providerData.get(key).baseURL = envValue;
            continue;
        }

        // Check for KEY_ENV (must check before KEY)
        match = envKey.match(keyEnvPattern);
        if (match) {
            const [, apiType, providerName] = match;
            const key = `${apiType}_${providerName}`;
            if (!providerData.has(key)) {
                providerData.set(key, { apiType, providerName });
            }
            providerData.get(key).apiKeyEnv = envValue;
            continue;
        }

        // Check for KEY (direct key value)
        match = envKey.match(keyPattern);
        if (match) {
            const [, apiType, providerName] = match;
            const key = `${apiType}_${providerName}`;
            if (!providerData.has(key)) {
                providerData.set(key, { apiType, providerName });
            }
            // Store the direct key - we'll create a synthetic env var for it
            providerData.get(key).directKey = envValue;
            continue;
        }
    }

    // Build provider configs from collected data
    for (const [key, data] of providerData.entries()) {
        if (!data.baseURL) {
            // Provider must have a URL
            continue;
        }

        const providerKey = data.providerName.toLowerCase();
        const apiType = data.apiType.toLowerCase();

        // Determine the module based on API type
        const module = apiType === 'anthropic' ? ANTHROPIC_MODULE : OPENAI_MODULE;

        // Determine API key env var
        let apiKeyEnv = data.apiKeyEnv;
        if (!apiKeyEnv && data.directKey) {
            // Create a synthetic env var name and set it
            apiKeyEnv = `${data.apiType}_${data.providerName}_API_KEY`;
            process.env[apiKeyEnv] = data.directKey;
        }
        if (!apiKeyEnv) {
            // Default to <PROVIDER>_API_KEY
            apiKeyEnv = `${data.providerName}_API_KEY`;
        }

        providers.set(providerKey, {
            name: providerKey,
            providerKey,
            baseURL: data.baseURL,
            apiKeyEnv,
            module,
            apiType,
            fromEnv: true,
        });
    }

    return providers;
}

/**
 * Extract model definitions from environment variables.
 * Looks for patterns like LLM_MODEL_<NN>=provider/model|mode|...
 * 
 * @returns {Array<object>} Array of model definitions in order
 */
function parseModelsFromEnv() {
    const models = [];
    const modelEntries = [];

    // Pattern: LLM_MODEL_<anything> (typically numbered like LLM_MODEL_01)
    const modelPattern = /^LLM_MODEL_(.+)$/;

    for (const [envKey, envValue] of Object.entries(process.env)) {
        if (!envValue) continue;

        const match = envKey.match(modelPattern);
        if (match) {
            const suffix = match[1];
            const parsed = parseModelDefinition(envValue);
            if (parsed) {
                parsed.envKey = envKey;
                parsed.fromEnv = true;
                modelEntries.push({ suffix, model: parsed });
            }
        }
    }

    // Sort by suffix to maintain ordering (e.g., 01, 02, 03)
    modelEntries.sort((a, b) => a.suffix.localeCompare(b.suffix, undefined, { numeric: true }));

    for (const entry of modelEntries) {
        models.push(entry.model);
    }

    return models;
}

/**
 * Parse a provider/model reference string.
 * 
 * @param {string} ref - Reference like "provider/model" or just "model"
 * @returns {object} { provider: string|null, model: string }
 */
export function parseModelReference(ref) {
    if (!ref || typeof ref !== 'string') {
        return { provider: null, model: ref || '' };
    }

    const trimmed = ref.trim();
    const slashIdx = trimmed.indexOf('/');
    if (slashIdx === -1) {
        return { provider: null, model: trimmed };
    }

    return {
        provider: trimmed.substring(0, slashIdx).toLowerCase(),
        model: trimmed.substring(slashIdx + 1),
    };
}

/**
 * Parse a comma/semicolon-separated list of model references.
 * Supports provider/model format.
 * 
 * @param {string} value - Comma or semicolon separated list
 * @returns {Array<{provider: string|null, model: string, qualified: string}>}
 */
export function parseModelList(value) {
    if (!value || typeof value !== 'string') {
        return [];
    }

    const trimmed = value.trim();
    if (!trimmed) {
        return [];
    }

    // Try JSON array first
    try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
            return parsed
                .filter(item => typeof item === 'string' && item.trim())
                .map(item => {
                    const ref = parseModelReference(item);
                    return {
                        ...ref,
                        qualified: ref.provider ? `${ref.provider}/${ref.model}` : ref.model,
                    };
                });
        }
    } catch {
        // Not JSON, continue with delimiter parsing
    }

    // Split by comma or semicolon
    return trimmed.split(/[;,]/)
        .map(item => item.trim())
        .filter(Boolean)
        .map(item => {
            const ref = parseModelReference(item);
            return {
                ...ref,
                qualified: ref.provider ? `${ref.provider}/${ref.model}` : ref.model,
            };
        });
}

/**
 * Load provider and model configurations from environment variables.
 * 
 * @returns {object} { providers: Map, models: Array, issues: { errors: [], warnings: [] } }
 */
export function loadEnvConfig() {
    const issues = { errors: [], warnings: [] };

    const providers = parseProvidersFromEnv();
    const models = parseModelsFromEnv();

    // Validate that models reference known providers
    for (const model of models) {
        if (!providers.has(model.provider)) {
            issues.warnings.push(
                `Env model "${model.qualifiedName}" references provider "${model.provider}" which is not defined in env. ` +
                `It may exist in LLMConfig.json.`
            );
        }
    }

    return {
        providers,
        models,
        issues,
    };
}

// Named export for parseModelDefinition
export { parseModelDefinition };

export default {
    loadEnvConfig,
    parseModelReference,
    parseModelList,
    parseModelDefinition,
};
