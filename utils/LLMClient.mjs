import { loadModelsConfiguration, resolveModelName, parseModelReference } from './LLMProviders/providers/modelsConfigLoader.mjs';
export { loadModelsConfiguration, resolveModelName, parseModelReference };
import { registerProvidersFromConfig } from './LLMProviders/providerBootstrap.mjs';
import { ensureProvider } from './LLMProviders/providers/providerRegistry.mjs';
const debugFlag = (process.env.ACHILLES_DEBUG ?? '').toLowerCase();
const DEBUG_ENABLED = debugFlag === '1' || debugFlag === 'true';

const modelsConfiguration = await loadModelsConfiguration();

await registerProvidersFromConfig(modelsConfiguration);

const llmCalls = [];

// ── Model Registry ──────────────────────────────────────────────────

function createAgentModelRecord(modelDescriptor, providerConfig) {
    if (!modelDescriptor || !providerConfig) {
        return null;
    }
    const tier = modelDescriptor.tier === 'deep' ? 'deep' : 'fast';
    return {
        name: modelDescriptor.name,
        providerKey: modelDescriptor.providerKey,
        apiKeyEnv: modelDescriptor.apiKeyEnv || providerConfig.apiKeyEnv || null,
        baseURL: modelDescriptor.baseURL || providerConfig.baseURL || null,
        tier,
        tags: modelDescriptor.tags || [],
        sortOrder: modelDescriptor.sortOrder ?? 100,
        isFree: modelDescriptor.isFree || false,
        billingType: modelDescriptor.billingType || 'api_key',
    };
}

function buildModelRegistry() {
    const recordMap = new Map();
    const fast = [];
    const deep = [];

    const orderedNames = Array.isArray(modelsConfiguration.orderedModels) && modelsConfiguration.orderedModels.length
        ? modelsConfiguration.orderedModels
        : Array.from(modelsConfiguration.models.keys());

    for (const name of orderedNames) {
        if (recordMap.has(name)) continue;
        const descriptor = modelsConfiguration.models.get(name);
        if (!descriptor) continue;
        const providerConfig = modelsConfiguration.providers.get(descriptor.providerKey);
        if (!providerConfig) continue;
        const record = createAgentModelRecord(descriptor, providerConfig);
        if (!record) continue;

        record.qualifiedName = `${record.providerKey}/${record.name}`;
        recordMap.set(name, record);
        if (record.tier === 'deep') {
            deep.push(name);
        } else {
            fast.push(name);
        }
    }

    return { recordMap, fast, deep };
}

let modelRecordMap;
let fastModelNames;
let deepModelNames;

function ensureRegistryFresh() {
    if (!modelRecordMap) {
        const reg = buildModelRegistry();
        modelRecordMap = reg.recordMap;
        fastModelNames = reg.fast;
        deepModelNames = reg.deep;
    }
}

// ── Model Resolution (no cascade) ──────────────────────────────────

/**
 * Select the best model matching the requested tags.
 * Scores each known model by tag overlap count, preferring lower sortOrder on ties.
 * Only considers models whose provider API key is available.
 */
export function selectModelByTags(requestedTags) {
    if (!requestedTags || !requestedTags.length) return null;
    ensureRegistryFresh();

    let bestModel = null;
    let bestScore = -1;
    let bestSortOrder = Infinity;

    for (const [name, record] of modelRecordMap) {
        const modelTags = record.tags || [];
        if (!modelTags.length) continue;

        // Check provider has API key available
        const keyEnv = record.apiKeyEnv;
        if (keyEnv && !process.env[keyEnv]) continue;

        let score = 0;
        for (const tag of requestedTags) {
            if (modelTags.includes(tag)) score++;
        }
        if (score === 0) continue;

        if (score > bestScore || (score === bestScore && (record.sortOrder ?? 100) < bestSortOrder)) {
            bestScore = score;
            bestModel = name;
            bestSortOrder = record.sortOrder ?? 100;
        }
    }

    return bestModel;
}

/**
 * Resolve invocation parameters to a single model name.
 * Priority: explicit model > tags > tier/mode (as intent or passthrough) > default.
 * No cascade — returns one model. Soul Gateway handles tier resolution and fallback.
 */
export function resolveModelForInvocation({ model, tags, tier, mode }) {
    // 1. Explicit model → resolve name and pass through
    if (model) {
        const resolved = resolveModelName(model, modelsConfiguration.models, modelsConfiguration.qualifiedModels);
        return resolved || model; // unknown names pass through (gateway may know them)
    }

    // 2. Tags → select best match from known models
    if (tags && Array.isArray(tags) && tags.length > 0) {
        const selected = selectModelByTags(tags);
        if (selected) return selected;
    }

    // 3. Tier/mode → look up in defaults map, or pass through as-is
    const intent = tier || mode || 'fast';
    const defaultModel = modelsConfiguration.defaults?.get(intent);
    if (defaultModel) {
        const resolved = resolveModelName(defaultModel, modelsConfiguration.models, modelsConfiguration.qualifiedModels);
        return resolved || defaultModel;
    }

    // 4. Pass intent name directly (soul-gateway resolves tier names)
    return intent;
}

// ── Backward-compat exports ─────────────────────────────────────────

export function getPrioritizedModels(requestedTier = null) {
    ensureRegistryFresh();
    const model = resolveModelForInvocation({ tier: requestedTier });
    return model ? [model] : [];
}

export function listModelsFromCache() {
    ensureRegistryFresh();
    const clone = (names) => names.map((name) => {
        const record = modelRecordMap.get(name);
        return record ? { ...record } : null;
    }).filter(Boolean);

    return {
        fast: clone(fastModelNames),
        deep: clone(deepModelNames),
    };
}


// ── Core LLM Call Infrastructure ────────────────────────────────────

function getModelMetadata(modelName) {
    let resolvedName = modelName;
    if (modelName) {
        const resolved = resolveModelName(
            modelName,
            modelsConfiguration.models,
            modelsConfiguration.qualifiedModels
        );
        if (resolved) {
            resolvedName = resolved;
        }
    }

    const modelDescriptor = modelsConfiguration.models.get(resolvedName);
    if (!modelDescriptor) {
        return null;
    }
    const providerConfig = modelsConfiguration.providers.get(modelDescriptor.providerKey) || null;
    return {
        model: modelDescriptor,
        provider: providerConfig,
    };
}

function resolveProviderKey(modelName, invocationOptions, metadata) {
    if (invocationOptions.providerKey) {
        return invocationOptions.providerKey;
    }
    if (metadata?.model?.providerKey) {
        return metadata.model.providerKey;
    }
    if (metadata?.provider?.providerKey) {
        return metadata.provider.providerKey;
    }
    throw new Error(`Model "${modelName}" is not configured with a provider.`);
}

function resolveApiKey(invocationOptions, metadata) {
    if (invocationOptions.apiKey) {
        return invocationOptions.apiKey;
    }

    const configuredEnv = invocationOptions.apiKeyEnv
        || metadata?.model?.apiKeyEnv
        || metadata?.provider?.apiKeyEnv;

    if (configuredEnv && process.env[configuredEnv]) {
        return process.env[configuredEnv];
    }

    return process.env.LLM_API_KEY || null;
}

export async function callLLM(historyArray, prompt, options = {}) {
    const modelName = options?.model;
    if (!modelName || typeof modelName !== 'string') {
        throw new Error('callLLM requires options.model to be specified.');
    }
    return callLLMWithModel(modelName, historyArray, prompt, options);
}

async function callLLMWithModelInternal(modelName, historyArray, prompt, invocationOptions = {}) {
    const controller = new AbortController();
    llmCalls.push(controller);

    const history = Array.isArray(historyArray) ? historyArray.slice() : [];
    if (prompt) {
        history.push({ role: 'human', message: prompt });
    }

    const externalSignal = invocationOptions.signal;
    if (externalSignal && typeof externalSignal.addEventListener === 'function') {
        const abortHandler = () => controller.abort();
        externalSignal.addEventListener('abort', abortHandler, { once: true });
    }

    try {
        let metadata = getModelMetadata(modelName);

        // For unregistered qualified names (e.g. "soul_gateway/fast"), extract provider
        // from prefix and resolve the provider config directly. This allows default
        // entries like "soul_gateway/fast" to route through the correct provider even
        // when "fast" is a tier name (not a registered model) on the gateway.
        let inferredProviderKey = null;
        let inferredModelName = modelName;
        if (!metadata && modelName.includes('/')) {
            const { provider: prefix, model: suffix } = parseModelReference(modelName);
            if (prefix && modelsConfiguration.providers.has(prefix)) {
                inferredProviderKey = prefix;
                inferredModelName = suffix;
                const providerConfig = modelsConfiguration.providers.get(prefix);
                metadata = { model: null, provider: providerConfig };
            }
        }

        const providerKey = resolveProviderKey(modelName, invocationOptions, metadata)
            || inferredProviderKey;
        const provider = ensureProvider(providerKey);

        const baseURL = invocationOptions.baseURL
            || metadata?.model?.baseURL
            || metadata?.provider?.baseURL;

        if (!baseURL) {
            throw new Error(`Missing base URL for provider "${providerKey}" and model "${modelName}".`);
        }

        const apiKey = resolveApiKey(invocationOptions, metadata);
        if (!apiKey && providerKey !== 'huggingface') {
            throw new Error(`Missing API key for provider "${providerKey}".`);
        }

        const actualModelName = metadata?.model?.name || inferredModelName;

        const agentHeaders = invocationOptions.headers || {};
        if (process.env.AGENT_NAME && !agentHeaders['X-Soul-Agent']) {
            agentHeaders['X-Soul-Agent'] = process.env.AGENT_NAME;
        }

        return await provider.callLLM(history, {
            model: actualModelName,
            providerKey,
            apiKey,
            baseURL,
            signal: controller.signal,
            params: invocationOptions.params || {},
            headers: agentHeaders,
        });
    } catch (error) {
        throw error;
    } finally {
        const index = llmCalls.indexOf(controller);
        if (index > -1) {
            llmCalls.splice(index, 1);
        }
    }
}

let callLLMWithModelImpl = callLLMWithModelInternal;

export async function callLLMWithModel(modelName, historyArray, prompt, invocationOptions = {}) {
    return callLLMWithModelImpl(modelName, historyArray, prompt, invocationOptions);
}

export function cancelRequests() {
    llmCalls.forEach(controller => controller.abort());
    llmCalls.length = 0;
}

export function __setCallLLMWithModelForTests(fn) {
    if (typeof fn !== 'function') {
        throw new TypeError('Expected function when overriding callLLMWithModel implementation.');
    }
    callLLMWithModelImpl = fn;
}

export function __resetCallLLMWithModelForTests() {
    callLLMWithModelImpl = callLLMWithModelInternal;
}

// ── Invoker Strategy (single-call, no cascade) ─────────────────────

export function createDefaultLLMInvokerStrategy() {
    ensureRegistryFresh();
    const cachedModels = listModelsFromCache();
    let lastInvocationDetails = { model: null, tier: null };

    const invokerStrategy = async function defaultLLMInvokerStrategy(invocation = {}) {
        const {
            prompt,
            history = [],
            mode = null,
            tier = null,
            model = null,
            tags = null,
            params = {},
            headers = {},
            signal = null,
            invocationOptions = {},
            responseValidator = null,
        } = invocation;

        if (!prompt || typeof prompt !== 'string') {
            throw new Error('defaultLLMInvokerStrategy requires a prompt string.');
        }

        if (!modelsConfiguration.models || modelsConfiguration.models.size === 0) {
            throw new Error(`No LLM models are configured in ${modelsConfiguration.path || 'the LLM configuration file'}.`);
        }

        // Resolve to a single model name — no cascade
        const modelName = resolveModelForInvocation({ model, tags, tier, mode });
        const effectiveTier = tier || mode || 'auto';
        lastInvocationDetails = { model: null, tier: effectiveTier };

        const record = modelRecordMap?.get(modelName) || null;

        const mergedHeaders = { ...(invocationOptions.headers || {}), ...headers };
        if (process.env.AGENT_NAME && !mergedHeaders['X-Soul-Agent']) {
            mergedHeaders['X-Soul-Agent'] = process.env.AGENT_NAME;
        }

        const invocationConfig = {
            ...invocationOptions,
            params: { ...(invocationOptions.params || {}), ...params },
            headers: mergedHeaders,
        };

        if (invocation.providerKey) invocationConfig.providerKey = invocation.providerKey;
        if (invocation.apiKey) invocationConfig.apiKey = invocation.apiKey;
        if (invocation.apiKeyEnv) invocationConfig.apiKeyEnv = invocation.apiKeyEnv;
        if (invocation.baseURL) invocationConfig.baseURL = invocation.baseURL;
        if (signal) invocationConfig.signal = signal;

        // Fill from record if not already set
        if (!invocationConfig.providerKey && record?.providerKey) {
            invocationConfig.providerKey = record.providerKey;
        }
        if (!invocationConfig.baseURL && record?.baseURL) {
            invocationConfig.baseURL = record.baseURL;
        }
        if (!invocationConfig.apiKeyEnv && record?.apiKeyEnv) {
            invocationConfig.apiKeyEnv = record.apiKeyEnv;
        }

        if (DEBUG_ENABLED) {
            console.info(`[AchillesAgentsLib] LLM call -> provider: ${record?.providerKey || 'unknown'}, model: ${modelName}, tier: ${effectiveTier}`);
        }

        const attemptHistory = Array.isArray(history) ? history.slice() : [];
        const output = await callLLMWithModel(modelName, attemptHistory, prompt, invocationConfig);

        if (typeof responseValidator === 'function') {
            responseValidator(output);
        }

        lastInvocationDetails = { model: modelName, tier: effectiveTier };
        return {
            output,
            model: modelName,
            tier: effectiveTier,
        };
    };

    // Backward-compat helper methods
    const defaultsList = modelsConfiguration.defaults ? [...modelsConfiguration.defaults.keys()] : [];
    invokerStrategy.getSupportedModes = () => defaultsList.slice();
    invokerStrategy.listAvailableModels = () => ({
        fast: cachedModels.fast.map(record => ({ ...record })),
        deep: cachedModels.deep.map(record => ({ ...record })),
    });
    invokerStrategy.getLastInvocationDetails = () => ({ ...lastInvocationDetails });
    invokerStrategy.describe = () => ({
        configPath: modelsConfiguration.path || null,
        defaults: defaultsList,
        fastModels: cachedModels.fast.map((record) => ({
            name: record.name,
            apiKeyEnv: record.apiKeyEnv || null,
        })),
        deepModels: cachedModels.deep.map((record) => ({
            name: record.name,
            apiKeyEnv: record.apiKeyEnv || null,
        })),
    });

    return invokerStrategy;
}

export const defaultLLMInvokerStrategy = createDefaultLLMInvokerStrategy();
