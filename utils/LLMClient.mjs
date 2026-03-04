import { loadModelsConfiguration, resolveModelName, parseModelReference } from './LLMProviders/providers/modelsConfigLoader.mjs';
export { loadModelsConfiguration, resolveModelName, parseModelReference };
import { registerProvidersFromConfig } from './LLMProviders/providerBootstrap.mjs';
import { ensureProvider } from './LLMProviders/providers/providerRegistry.mjs';
const debugFlag = (process.env.ACHILLES_DEBUG ?? '').toLowerCase();
const DEBUG_ENABLED = debugFlag === '1' || debugFlag === 'true';

const modelsConfiguration = await loadModelsConfiguration();

await registerProvidersFromConfig(modelsConfiguration);

const llmCalls = [];

const VALID_TIERS = new Set(['fast', 'plan', 'write', 'code', 'deep', 'ultra']);

function createAgentModelRecord(modelDescriptor, providerConfig) {
    if (!modelDescriptor || !providerConfig) {
        return null;
    }
    const mode = modelDescriptor.mode === 'deep' ? 'deep' : 'fast';
    return {
        name: modelDescriptor.name,
        providerKey: modelDescriptor.providerKey,
        apiKeyEnv: modelDescriptor.apiKeyEnv || providerConfig.apiKeyEnv || null,
        baseURL: modelDescriptor.baseURL || providerConfig.baseURL || null,
        mode,
    };
}

/**
 * Resolve a tier's model list by walking the fallback chain.
 * Returns a flat array of model names (deduplicated, filtered to available models).
 * Supports both unqualified ("axiologic-fast") and qualified ("soul_gateway/axiologic-fast") names.
 */
function resolveTierModelList(tierName, tiersMap, recordMap, visited = new Set()) {
    if (visited.has(tierName)) return []; // cycle detection
    visited.add(tierName);
    const tier = tiersMap.get(tierName);
    if (!tier) return [];
    const result = [];
    const seen = new Set();

    const tryAdd = (model) => {
        // Try direct lookup first
        if (recordMap.has(model) && !seen.has(model)) {
            seen.add(model);
            result.push(model);
            return;
        }
        // Try resolving qualified name (e.g. "soul_gateway/axiologic-fast" → "axiologic-fast")
        if (model.includes('/')) {
            const resolved = resolveModelName(
                model,
                modelsConfiguration.models,
                modelsConfiguration.qualifiedModels
            );
            if (resolved && recordMap.has(resolved) && !seen.has(resolved)) {
                seen.add(resolved);
                result.push(resolved);
            }
        }
    };

    for (const model of tier.models) {
        tryAdd(model);
    }
    if (tier.fallback) {
        for (const model of resolveTierModelList(tier.fallback, tiersMap, recordMap, visited)) {
            if (!seen.has(model)) {
                seen.add(model);
                result.push(model);
            }
        }
    }
    return result;
}

function buildModelCaches() {
    const recordMap = new Map();
    const fast = [];
    const deep = [];

    const defaultFastModel = modelsConfiguration.defaultFastModel || null;
    const defaultDeepModel = modelsConfiguration.defaultDeepModel || null;
    const fastModelPriority = modelsConfiguration.fastModelPriority || null;
    const deepModelPriority = modelsConfiguration.deepModelPriority || null;

    const orderedNames = Array.isArray(modelsConfiguration.orderedModels) && modelsConfiguration.orderedModels.length
        ? modelsConfiguration.orderedModels
        : Array.from(modelsConfiguration.models.keys());

    for (const name of orderedNames) {
        if (recordMap.has(name)) {
            continue;
        }
        const descriptor = modelsConfiguration.models.get(name);
        if (!descriptor) {
            continue;
        }
        const providerConfig = modelsConfiguration.providers.get(descriptor.providerKey);
        if (!providerConfig) {
            continue;
        }
        const record = createAgentModelRecord(descriptor, providerConfig);
        if (!record) {
            continue;
        }

        record.qualifiedName = `${record.providerKey}/${record.name}`;
        recordMap.set(name, record);
        if (record.mode === 'deep') {
            deep.push(name);
        } else {
            fast.push(name);
        }
    }

    // Apply config priority ordering
    const applyPriorityOrder = (list, priorityList) => {
        if (!priorityList || !priorityList.length) {
            return;
        }
        const validPriority = priorityList.filter(name => {
            if (!list.includes(name)) return false;
            const record = recordMap.get(name);
            if (!record) return false;
            const apiKeyEnv = record.apiKeyEnv;
            return !apiKeyEnv || process.env[apiKeyEnv];
        });
        if (!validPriority.length) return;
        for (const name of validPriority) {
            const idx = list.indexOf(name);
            if (idx > -1) {
                list.splice(idx, 1);
            }
        }
        list.unshift(...validPriority);
    };

    if (fastModelPriority) {
        applyPriorityOrder(fast, fastModelPriority);
    }
    if (deepModelPriority) {
        applyPriorityOrder(deep, deepModelPriority);
    }

    // Prioritize default model if no priority array is set
    const prioritizeDefault = (list, preferred) => {
        const idx = list.indexOf(preferred);
        if (idx > 0) {
            list.splice(idx, 1);
            list.unshift(preferred);
        }
    };

    if (!fastModelPriority && defaultFastModel && recordMap.has(defaultFastModel)) {
        const record = recordMap.get(defaultFastModel);
        if (record.mode === 'fast') {
            prioritizeDefault(fast, defaultFastModel);
        }
    }

    if (!deepModelPriority && defaultDeepModel && recordMap.has(defaultDeepModel)) {
        const record = recordMap.get(defaultDeepModel);
        if (record.mode === 'deep') {
            prioritizeDefault(deep, defaultDeepModel);
        }
    }

    // Build tier map from modelsConfiguration.tiers
    const tiers = new Map();
    const configTiers = modelsConfiguration.tiers;
    if (configTiers && configTiers.size > 0) {
        for (const [tierName] of configTiers) {
            const resolved = resolveTierModelList(tierName, configTiers, recordMap);
            if (resolved.length) {
                tiers.set(tierName, resolved);
            }
        }
    }

    // When no tiers are configured, synthesize fast/deep tiers from model records
    if (tiers.size === 0) {
        if (fast.length) tiers.set('fast', [...fast]);
        if (deep.length) tiers.set('deep', [...deep]);
    }

    const defaultTier = tiers.has('fast') ? 'fast' : (tiers.size > 0 ? tiers.keys().next().value : 'fast');

    return { recordMap, fast, deep, defaultTier, tiers };
}

let modelRecordMap;
let fastModelNames;
let deepModelNames;
let defaultTier;
let tierMap;

function rebuildCaches() {
    const caches = buildModelCaches();
    modelRecordMap = caches.recordMap;
    fastModelNames = caches.fast;
    deepModelNames = caches.deep;
    defaultTier = caches.defaultTier;
    tierMap = caches.tiers;
}

function normalizeTierPreference(value) {
    if (typeof value !== 'string') return null;
    const normalized = value.trim().toLowerCase();
    if (VALID_TIERS.has(normalized)) return normalized;
    if (tierMap && tierMap.has(normalized)) return normalized;
    return null;
}

function normalizeInvocationPreferences(input) {
    if (typeof input === 'string') {
        return { tier: normalizeTierPreference(input), modelName: null };
    }

    if (!input || typeof input !== 'object') {
        return { tier: null, modelName: null };
    }

    // Accept both 'tier' and 'mode' (legacy alias); tier takes precedence
    const tier = normalizeTierPreference(input.tier)
        || normalizeTierPreference(input.mode || input.preferredMode || input.modePreference);
    const modelRaw = input.modelName || input.model || input.preferredModel;
    const modelName = typeof modelRaw === 'string' && modelRaw.trim() ? modelRaw.trim() : null;

    return { tier, modelName };
}

function resolvePrioritizedModels({ tier, modelName }) {
    const prioritized = [];
    const seen = new Set();

    const push = (name) => {
        if (name && modelRecordMap.has(name) && !seen.has(name)) {
            seen.add(name);
            prioritized.push(name);
        }
    };

    if (modelName) {
        let resolvedName = modelName;
        if (modelName.includes('/')) {
            const resolved = resolveModelName(
                modelName,
                modelsConfiguration.models,
                modelsConfiguration.qualifiedModels
            );
            if (resolved) {
                resolvedName = resolved;
            }
        }
        push(resolvedName);
        return prioritized.length ? prioritized : [];
    }

    // Tier-based resolution
    const effectiveTier = tier || defaultTier;
    if (tierMap && tierMap.has(effectiveTier)) {
        tierMap.get(effectiveTier).forEach(push);
    }

    // If no models found for this tier, add all available models as fallback
    if (!prioritized.length) {
        for (const [, models] of tierMap) {
            models.forEach(push);
        }
    }

    return prioritized;
}

export function getPrioritizedModels(requestedTier = null) {
    rebuildCaches();
    return resolvePrioritizedModels({
        tier: requestedTier || null,
        modelName: null,
    });
}

function ensureCachesFresh() {
    if (!modelRecordMap || !fastModelNames || !deepModelNames) {
        rebuildCaches();
    }
}

function getSupportedTiersFromCache() {
    ensureCachesFresh();
    if (tierMap && tierMap.size > 0) {
        return [...tierMap.keys()];
    }
    return ['fast'];
}

export function listModelsFromCache() {
    ensureCachesFresh();
    const clone = (names) => names.map((name) => {
        const record = modelRecordMap.get(name);
        return record ? { ...record } : null;
    }).filter(Boolean);

    return {
        fast: clone(fastModelNames),
        deep: clone(deepModelNames),
    };
}

export function listTiersFromCache() {
    ensureCachesFresh();
    if (!tierMap || tierMap.size === 0) return {};
    const result = {};
    for (const [name, models] of tierMap) {
        result[name] = [...models];
    }
    return result;
}

function getModelMetadata(modelName) {
    // Resolve model name (supports provider/model format and promoted duplicate names)
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
        const metadata = getModelMetadata(modelName);
        const providerKey = resolveProviderKey(modelName, invocationOptions, metadata);
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

        // Use the resolved model name (without provider prefix) for the API call
        const actualModelName = metadata?.model?.name || modelName;
        
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

export function createDefaultLLMInvokerStrategy() {
    const supportedTiers = getSupportedTiersFromCache();
    const cachedModels = listModelsFromCache();
    let lastInvocationDetails = { model: null, mode: null };

    const invokerStrategy = async function defaultLLMInvokerStrategy(invocation = {}) {
        const {
            prompt,
            history = [],
            mode = null,
            tier = null,
            model = null,
            modelCandidates = null,
            params = {},
            headers = {},
            signal = null,
            invocationOptions = {},
            responseValidator = null,
        } = invocation;

        if (!prompt || typeof prompt !== 'string') {
            throw new Error('defaultLLMInvokerStrategy requires a prompt string.');
        }

        if (!tierMap || !tierMap.size) {
            throw new Error(`No LLM models are configured in ${modelsConfiguration.path || 'the LLM configuration file'}.`);
        }

        const normalizedPreferences = normalizeInvocationPreferences({ mode, tier, model });
        const effectiveTier = normalizedPreferences.tier || defaultTier;

        const selectionRequest = {
            tier: effectiveTier,
            modelName: normalizedPreferences.modelName || null,
        };
        lastInvocationDetails = { model: null, mode: effectiveTier };

        const prioritized = Array.isArray(modelCandidates) && modelCandidates.length
            ? modelCandidates
            : resolvePrioritizedModels(selectionRequest);

        if (!prioritized.length) {
            if (selectionRequest.modelName) {
                throw new Error(`Model "${selectionRequest.modelName}" is not defined in ${modelsConfiguration.path || 'the LLM configuration file'}.`);
            }
            throw new Error(`No models available for tier "${effectiveTier}". Update ${modelsConfiguration.path || 'the LLM configuration file'} to include at least one model.`);
        }

        const mergedHeaders = { ...(invocationOptions.headers || {}), ...headers };
        if (process.env.AGENT_NAME && !mergedHeaders['X-Soul-Agent']) {
            mergedHeaders['X-Soul-Agent'] = process.env.AGENT_NAME;
        }

        const baseOptions = {
            ...invocationOptions,
            params: { ...(invocationOptions.params || {}), ...params },
            headers: mergedHeaders,
            mode: effectiveTier,
        };

        if (invocation.providerKey) {
            baseOptions.providerKey = invocation.providerKey;
        }
        if (invocation.apiKey) {
            baseOptions.apiKey = invocation.apiKey;
        }
        if (invocation.apiKeyEnv) {
            baseOptions.apiKeyEnv = invocation.apiKeyEnv;
        }
        if (invocation.baseURL) {
            baseOptions.baseURL = invocation.baseURL;
        }
        if (signal) {
            baseOptions.signal = signal;
        }

        const attempts = [];
        for (const candidate of prioritized) {
            const record = modelRecordMap.get(candidate) || null;
            const invocationConfig = { ...baseOptions };

            if (!invocationConfig.providerKey && record?.providerKey) {
                invocationConfig.providerKey = record.providerKey;
            }
            if (!invocationConfig.baseURL && record?.baseURL) {
                invocationConfig.baseURL = record.baseURL;
            }
            if (!invocationConfig.apiKeyEnv && record?.apiKeyEnv) {
                invocationConfig.apiKeyEnv = record.apiKeyEnv;
            }

            try {
                const attemptHistory = Array.isArray(history) ? history.slice() : [];
                const effectiveMode = record.mode;
                if (DEBUG_ENABLED) {
                    console.info(`[AchillesAgentsLib] LLM call -> provider: ${record.providerKey}, model: ${candidate}, mode: ${effectiveMode}`);
                }
                const output = await callLLMWithModel(candidate, attemptHistory, prompt, invocationConfig);
                if (typeof responseValidator === 'function') {
                    responseValidator(output);
                }
                lastInvocationDetails = { model: candidate, mode: effectiveMode };
                return {
                    output,
                    model: candidate,
                    mode: effectiveMode,
                };
            } catch (error) {
                console.warn(`[AchillesAgentsLib] LLM cascade fail -> provider: ${record.providerKey}, model: ${candidate}, error: ${error?.message || error}`);
                attempts.push({ model: candidate, error });
            }
        }

        const detail = attempts
            .map(({ model: candidate, error }) => `${candidate}: ${error?.message || error}`)
            .join('; ');

        const aggregatedError = new Error(detail ? `All model invocations failed: ${detail}` : 'All model invocations failed.');
        aggregatedError.attempts = attempts;
        aggregatedError.tier = effectiveTier;
        aggregatedError.modelsTried = prioritized.slice();
        aggregatedError.configurationPath = modelsConfiguration.path || null;
        lastInvocationDetails = { model: null, mode: effectiveTier };
        throw aggregatedError;
    };

    invokerStrategy.getSupportedModes = () => supportedTiers.slice();
    invokerStrategy.listAvailableModels = () => ({
        fast: cachedModels.fast.map(record => ({ ...record })),
        deep: cachedModels.deep.map(record => ({ ...record })),
    });
    invokerStrategy.getLastInvocationDetails = () => ({ ...lastInvocationDetails });
    invokerStrategy.describe = () => ({
        configPath: modelsConfiguration.path || null,
        supportedTiers: invokerStrategy.getSupportedModes(),
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
