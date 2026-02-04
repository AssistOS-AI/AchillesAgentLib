import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvConfig, parseModelReference } from './envConfigLoader.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const VALID_MODES = new Set(['fast', 'deep']);
const DEFAULT_CONFIG_FILENAME = 'LLMConfig.json';
const DEFAULT_CONFIG_PATH = path.resolve(__dirname, '../../../', DEFAULT_CONFIG_FILENAME);

// Re-export for use by other modules
export { parseModelReference } from './envConfigLoader.mjs';

export function loadRawConfig(configPath = DEFAULT_CONFIG_PATH) {
    if (!fs.existsSync(configPath)) {
        return {
            raw: { providers: {}, models: {} },
            issues: { errors: [`${DEFAULT_CONFIG_FILENAME} not found at ${configPath}`], warnings: [] },
        };
    }

    try {
        const rawContent = fs.readFileSync(configPath, 'utf-8');
        const parsed = JSON.parse(rawContent);
        return { raw: parsed || {}, issues: { errors: [], warnings: [] } };
    } catch (error) {
        return {
            raw: { providers: {}, models: {} },
            issues: { errors: [`Failed to read ${DEFAULT_CONFIG_FILENAME}: ${error.message}`], warnings: [] },
        };
    }
}

export function normalizeConfig(rawConfig, options = {}) {
    const issues = { errors: [], warnings: [] };
    const providers = new Map();
    const models = new Map();
    const providerModels = new Map();
    const orderedModelNames = [];
    const defaultFastModel = selectString(rawConfig?.defaultFastModel, null);
    const defaultDeepModel = selectString(rawConfig?.defaultDeepModel, null);

    const rawProviders = rawConfig?.providers && typeof rawConfig.providers === 'object' ? rawConfig.providers : {};
    const rawModels = Array.isArray(rawConfig?.models) ? rawConfig.models : [];

    for (const [providerKey, entry] of Object.entries(rawProviders)) {
        const normalized = normalizeProvider(providerKey, entry, issues, options);
        providers.set(providerKey, normalized);
        providerModels.set(providerKey, []);
    }

    for (const entry of rawModels) {
        const normalized = normalizeModel(entry, providers, issues, options);
        if (!normalized) {
            continue;
        }
        const modelName = normalized.name;
        models.set(modelName, normalized);
        orderedModelNames.push(modelName);

        if (!providerModels.has(normalized.providerKey)) {
            providerModels.set(normalized.providerKey, []);
        }
        providerModels.get(normalized.providerKey).push(normalized);
    }

    validateProviders(providers, models, providerModels, issues);

    const validatedDefaults = {
        defaultFastModel: null,
        defaultDeepModel: null,
    };
    if (defaultFastModel) {
        const model = models.get(defaultFastModel);
        if (!model) {
            issues.warnings.push(`Default fast model "${defaultFastModel}" is not defined in ${DEFAULT_CONFIG_FILENAME}.`);
        } else if (model.mode !== 'fast') {
            issues.warnings.push(`Default fast model "${defaultFastModel}" is not configured as a fast model.`);
        } else {
            validatedDefaults.defaultFastModel = defaultFastModel;
        }
    }
    if (defaultDeepModel) {
        const model = models.get(defaultDeepModel);
        if (!model) {
            issues.warnings.push(`Default deep model "${defaultDeepModel}" is not defined in ${DEFAULT_CONFIG_FILENAME}.`);
        } else if (model.mode !== 'deep') {
            issues.warnings.push(`Default deep model "${defaultDeepModel}" is not configured as a deep model.`);
        } else {
            validatedDefaults.defaultDeepModel = defaultDeepModel;
        }
    }

    // Parse and validate priority arrays
    const fastModelPriority = normalizeModelPriorityArray(
        rawConfig?.fastModelPriority,
        models,
        'fast',
        issues,
    );
    const deepModelPriority = normalizeModelPriorityArray(
        rawConfig?.deepModelPriority,
        models,
        'deep',
        issues,
    );

    return {
        providers,
        models,
        providerModels,
        issues,
        raw: rawConfig,
        orderedModels: orderedModelNames,
        fastModelPriority,
        deepModelPriority,
        ...validatedDefaults,
    };
}

function normalizeModelPriorityArray(rawPriority, models, expectedMode, issues) {
    if (!Array.isArray(rawPriority) || rawPriority.length === 0) {
        return null;
    }

    const validated = [];
    for (const modelName of rawPriority) {
        if (typeof modelName !== 'string' || !modelName.trim()) {
            continue;
        }
        const trimmed = modelName.trim();
        const model = models.get(trimmed);
        if (!model) {
            issues.warnings.push(`Priority model "${trimmed}" in ${expectedMode}ModelPriority is not defined.`);
            continue;
        }
        if (model.mode !== expectedMode) {
            issues.warnings.push(`Priority model "${trimmed}" in ${expectedMode}ModelPriority has mode "${model.mode}" instead of "${expectedMode}".`);
        }
        validated.push(trimmed);
    }
    return validated.length > 0 ? validated : null;
}

function normalizeProvider(providerKey, entry, issues, options) {
    if (!entry || typeof entry !== 'object') {
        issues.warnings.push(`Provider "${providerKey}" configuration must be an object.`);
    }

    const config = entry && typeof entry === 'object' ? entry : {};
    const apiKeyEnv = config.apiKeyEnv;
    if (!apiKeyEnv) {
        issues.warnings.push(`Provider "${providerKey}" does not declare apiKeyEnv.`);
    }

    const baseURL = selectString(config.baseURL, null);
    if (!baseURL) {
        issues.warnings.push(`Provider "${providerKey}" is missing baseURL; requests may fail unless overridden per model.`);
    }

    const modulePath = selectString(config.module, null);
    const defaultModel = selectString(config.defaultModel, null);

    return {
        name: providerKey,
        providerKey,
        apiKeyEnv,
        baseURL,
        defaultModel,
        module: modulePath,
        extra: config.extra || {},
    };
}

function normalizeModel(entry, providers, issues, options) {
    const modelName = selectString(entry && typeof entry === 'object' ? entry.name : null, null);
    let providerKey = null;
    let mode = 'fast';
    let apiKeyEnvOverride = null;
    let baseURLOverride = null;

    if (!modelName) {
        issues.warnings.push('Model entry is missing required "name" property.');
        return null;
    }

    if (entry && typeof entry === 'object') {
        providerKey = entry.provider || entry.providerKey || null;
        mode = normalizeMode(entry.mode ?? entry.modes, issues, `model "${modelName}"`);
        apiKeyEnvOverride = selectString(entry.apiKeyEnv, null);
        baseURLOverride = selectString(entry.baseURL, null);
    } else {
        issues.warnings.push(`Model "${modelName}" configuration must be an object.`);
        return null;
    }

    if (!providerKey) {
        issues.errors.push(`Model "${modelName}" is missing provider reference.`);
        return null;
    }

    if (!providers.has(providerKey)) {
        issues.warnings.push(`Model "${modelName}" references unknown provider "${providerKey}".`);
    }

    return {
        name: modelName,
        providerKey,
        mode,
        apiKeyEnv: apiKeyEnvOverride,
        baseURL: baseURLOverride,
    };
}

function normalizeMode(rawMode, issues, context) {
    if (rawMode === undefined || rawMode === null) {
        return 'fast';
    }

    if (Array.isArray(rawMode)) {
        const normalized = rawMode
            .filter(value => typeof value === 'string')
            .map(value => value.toLowerCase())
            .filter(value => VALID_MODES.has(value));

        if (normalized.length > 1) {
            issues.warnings.push(`Model configuration for ${context} lists multiple modes; using "${normalized[0]}".`);
        }

        if (normalized.length) {
            return normalized[0];
        }

        issues.warnings.push(`No valid mode found for ${context}; defaulting to 'fast'.`);
        return 'fast';
    }

    if (typeof rawMode === 'string') {
        const lower = rawMode.toLowerCase();
        if (VALID_MODES.has(lower)) {
            return lower;
        }
    }

    issues.warnings.push(`Invalid mode value for ${context}; defaulting to 'fast'.`);
    return 'fast';
}

function validateProviders(providers, models, providerModels, issues) {
    for (const provider of providers.values()) {
        if (provider.defaultModel) {
            const model = models.get(provider.defaultModel);
            if (!model) {
                issues.warnings.push(`Provider "${provider.name}" defaultModel "${provider.defaultModel}" is not defined.`);
            } else if (model.providerKey !== provider.providerKey) {
                issues.warnings.push(`Provider "${provider.name}" defaultModel "${provider.defaultModel}" belongs to provider "${model.providerKey}".`);
            }
        }

        if (!providerModels.get(provider.providerKey)?.length) {
            issues.warnings.push(`Provider "${provider.name}" has no models defined.`);
        }
    }
}

function selectString(preferred, fallback) {
    if (typeof preferred === 'string' && preferred.trim()) {
        return preferred.trim();
    }
    if (typeof fallback === 'string' && fallback.trim()) {
        return fallback.trim();
    }
    return null;
}

/**
 * Merge environment-defined providers and models with JSON config.
 * Env definitions take precedence and are added first in the model order.
 * 
 * @param {object} normalized - Normalized config from JSON
 * @param {object} envConfig - Config loaded from environment variables
 * @returns {object} Merged configuration
 */
function mergeEnvConfig(normalized, envConfig) {
    const { providers, models, providerModels, orderedModels, issues } = normalized;
    
    // Build a map of qualified names (provider/model) for lookups
    const qualifiedModels = new Map();
    
    // Merge env providers (they take precedence over JSON)
    for (const [providerKey, envProvider] of envConfig.providers.entries()) {
        if (providers.has(providerKey)) {
            // Override existing provider
            const existing = providers.get(providerKey);
            providers.set(providerKey, { ...existing, ...envProvider });
        } else {
            // Add new provider
            providers.set(providerKey, envProvider);
            providerModels.set(providerKey, []);
        }
    }
    
    // Merge env models (prepend to maintain priority)
    const envModelNames = [];
    for (const envModel of envConfig.models) {
        const qualifiedName = `${envModel.providerKey}/${envModel.name}`;
        
        // Check if this model already exists (by qualified name)
        let existingKey = null;
        for (const [key, model] of models.entries()) {
            if (model.providerKey === envModel.providerKey && model.name === envModel.name) {
                existingKey = key;
                break;
            }
        }
        
        if (existingKey) {
            // Override existing model
            const existing = models.get(existingKey);
            models.set(existingKey, { ...existing, ...envModel, fromEnv: true });
        } else {
            // Add new model
            models.set(envModel.name, { ...envModel, fromEnv: true });
            envModelNames.push(envModel.name);
            
            // Add to provider's model list
            if (!providerModels.has(envModel.providerKey)) {
                providerModels.set(envModel.providerKey, []);
            }
            providerModels.get(envModel.providerKey).push(envModel);
        }
        
        // Always add to qualified lookup
        qualifiedModels.set(qualifiedName, envModel.name);
    }
    
    // Build qualified name index for all models (including JSON-defined)
    for (const [modelName, model] of models.entries()) {
        const qualifiedName = `${model.providerKey}/${model.name}`;
        if (!qualifiedModels.has(qualifiedName)) {
            qualifiedModels.set(qualifiedName, modelName);
        }
    }
    
    // Prepend env model names to ordered list
    normalized.orderedModels = [...envModelNames, ...orderedModels];
    
    // Add qualified models map to normalized config
    normalized.qualifiedModels = qualifiedModels;
    
    // Merge issues
    issues.errors.push(...envConfig.issues.errors);
    issues.warnings.push(...envConfig.issues.warnings);
    
    return normalized;
}

/**
 * Resolve a model name that may be in provider/model format.
 * Returns the model key used in the models map.
 * 
 * @param {string} modelRef - Model reference (either "model" or "provider/model")
 * @param {Map} models - Map of model names to model configs
 * @param {Map} qualifiedModels - Map of "provider/model" to model key
 * @returns {string|null} The model key, or null if not found
 */
export function resolveModelName(modelRef, models, qualifiedModels) {
    if (!modelRef) return null;
    
    const { provider, model } = parseModelReference(modelRef);
    
    if (provider) {
        // Qualified lookup: provider/model
        const qualifiedName = `${provider}/${model}`;
        if (qualifiedModels?.has(qualifiedName)) {
            return qualifiedModels.get(qualifiedName);
        }
        // Try direct lookup in case model name includes provider
        if (models.has(modelRef)) {
            return modelRef;
        }
        return null;
    }
    
    // Simple model name lookup
    if (models.has(model)) {
        return model;
    }
    
    return null;
}

export function loadModelsConfiguration(options = {}) {
    const configPath = options.configPath
        || process.env.LLM_MODELS_CONFIG_PATH
        || DEFAULT_CONFIG_PATH;
    const { raw, issues: loadIssues } = loadRawConfig(configPath);
    const normalized = normalizeConfig(raw, options);

    normalized.issues.errors.push(...loadIssues.errors);
    normalized.issues.warnings.push(...loadIssues.warnings);
    normalized.path = configPath;
    
    // Load and merge environment-defined providers and models
    const envConfig = loadEnvConfig();
    mergeEnvConfig(normalized, envConfig);
    
    return normalized;
}
