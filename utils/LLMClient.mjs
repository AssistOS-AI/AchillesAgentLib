import { loadModelsConfiguration } from './LLMProviders/providers/modelsConfigLoader.mjs';
export { loadModelsConfiguration };
import { registerBuiltInProviders } from './LLMProviders/providers/index.mjs';
import { registerProvidersFromConfig } from './LLMProviders/providerBootstrap.mjs';
import { ensureProvider } from './LLMProviders/providers/providerRegistry.mjs';

const debugFlag = (process.env.ACHILLES_DEBUG ?? process.env.ACHILES_DEBUG ?? '').toLowerCase();
const DEBUG_ENABLED = debugFlag === '1' || debugFlag === 'true';

const modelsConfiguration = loadModelsConfiguration();

const parseEnabledModelList = (rawValue) => {
    if (rawValue === undefined || rawValue === null) {
        return null;
    }

    const trimmed = typeof rawValue === 'string' ? rawValue.trim() : '';
    if (!trimmed) {
        return null;
    }

    let entries = [];
    const hadContent = trimmed.length > 0;
    try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
            entries = parsed;
        }
    } catch {
        // If JSON parsing fails, fall back to delimiter parsing below.
    }

    if (!entries.length) {
        entries = trimmed.split(/[;,]/);
    }

    const normalized = entries
        .map((value) => (typeof value === 'string' ? value.trim() : ''))
        .filter(Boolean);

    if (!normalized.length) {
        return hadContent ? new Set() : null;
    }

    return new Set(normalized);
};

const enabledFastModels = parseEnabledModelList(process.env.ACHILLES_ENABLED_FAST_MODELS);
const enabledDeepModels = parseEnabledModelList(process.env.ACHILLES_ENABLED_DEEP_MODELS);

registerBuiltInProviders();
await registerProvidersFromConfig(modelsConfiguration);

const llmCalls = [];

const VALID_MODES = new Set(['fast', 'deep']);

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

function buildModelCaches() {
    const recordMap = new Map();
    const fast = [];
    const deep = [];

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
        const allowedList = record.mode === 'deep' ? enabledDeepModels : enabledFastModels;
        if (allowedList && !allowedList.has(record.name)) {
            continue;
        }
        recordMap.set(record.name, record);
        if (record.mode === 'deep') {
            deep.push(record.name);
        } else {
            fast.push(record.name);
        }
    }

    return { recordMap, fast, deep };
}

const { recordMap: modelRecordMap, fast: fastModelNames, deep: deepModelNames } = buildModelCaches();
const defaultMode = fastModelNames.length ? 'fast' : (deepModelNames.length ? 'deep' : 'fast');

function normalizeModePreference(value) {
    if (typeof value !== 'string') {
        return null;
    }
    const normalized = value.trim().toLowerCase();
    return VALID_MODES.has(normalized) ? normalized : null;
}

function normalizeInvocationPreferences(input) {
    if (typeof input === 'string') {
        return { mode: normalizeModePreference(input), modelName: null };
    }

    if (!input || typeof input !== 'object') {
        return { mode: null, modelName: null };
    }

    const mode = normalizeModePreference(input.mode || input.preferredMode || input.modePreference);
    const modelRaw = input.modelName || input.model || input.preferredModel;
    const modelName = typeof modelRaw === 'string' && modelRaw.trim() ? modelRaw.trim() : null;

    return { mode, modelName };
}

function resolvePrioritizedModels({ mode, modelName }) {
    const prioritized = [];
    const seen = new Set();

    const push = (name) => {
        if (name && modelRecordMap.has(name) && !seen.has(name)) {
            seen.add(name);
            prioritized.push(name);
        }
    };

    if (modelName) {
        push(modelName);
        return prioritized.length ? prioritized : [];
    }

    const selectedMode = mode === 'deep' ? 'deep' : 'fast';
    const primaryList = selectedMode === 'deep' ? deepModelNames : fastModelNames;
    const fallbackList = selectedMode === 'deep' ? fastModelNames : deepModelNames;

    primaryList.forEach(push);
    fallbackList.forEach(push);

    return prioritized;
}

function getSupportedModesFromCache() {
    const modes = [];
    if (fastModelNames.length) {
        modes.push('fast');
    }
    if (deepModelNames.length) {
        modes.push('deep');
    }
    return modes.length ? modes : ['fast'];
}

export function listModelsFromCache() {
    const clone = (names) => names.map((name) => {
        const record = modelRecordMap.get(name);
        return record ? { ...record } : null;
    }).filter(Boolean);

    return {
        fast: clone(fastModelNames),
        deep: clone(deepModelNames),
    };
}

function getModelMetadata(modelName) {
    const modelDescriptor = modelsConfiguration.models.get(modelName);
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

        return await provider.callLLM(history, {
            model: modelName,
            providerKey,
            apiKey,
            baseURL,
            signal: controller.signal,
            params: invocationOptions.params || {},
            headers: invocationOptions.headers || {},
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
    const supportedModes = getSupportedModesFromCache();
    const cachedModels = listModelsFromCache();
    let lastInvocationDetails = { model: null, mode: null };

    const invokerStrategy = async function defaultLLMInvokerStrategy(invocation = {}) {
        const {
            prompt,
            history = [],
            mode = 'fast',
            model = null,
            modelCandidates = null,
            params = {},
            headers = {},
            signal = null,
            invocationOptions = {},
        } = invocation;

        if (!prompt || typeof prompt !== 'string') {
            throw new Error('defaultLLMInvokerStrategy requires a prompt string.');
        }

        if (!fastModelNames.length && !deepModelNames.length) {
            throw new Error(`No LLM models are configured in ${modelsConfiguration.path || 'the LLM configuration file'}.`);
        }

        const normalizedPreferences = normalizeInvocationPreferences({ mode, model });
        const effectiveMode = normalizedPreferences.mode
            || normalizeModePreference(mode)
            || defaultMode;

        const selectionRequest = {
            mode: effectiveMode,
            modelName: normalizedPreferences.modelName || null,
        };
        lastInvocationDetails = { model: null, mode: selectionRequest.mode };

        const prioritized = Array.isArray(modelCandidates) && modelCandidates.length
            ? modelCandidates
            : resolvePrioritizedModels(selectionRequest);

        if (!prioritized.length) {
            if (selectionRequest.modelName) {
                throw new Error(`Model "${selectionRequest.modelName}" is not defined in ${modelsConfiguration.path || 'the LLM configuration file'}.`);
            }
            throw new Error(`No models available for mode "${selectionRequest.mode}". Update ${modelsConfiguration.path || 'the LLM configuration file'} to include at least one model.`);
        }

        const baseOptions = {
            ...invocationOptions,
            params: { ...(invocationOptions.params || {}), ...params },
            headers: { ...(invocationOptions.headers || {}), ...headers },
            mode: selectionRequest.mode,
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
                    console.info(`[AchillesAgentsLib] LLM call -> model: ${candidate}, mode: ${effectiveMode}`);
                }
                const output = await callLLMWithModel(candidate, attemptHistory, prompt, invocationConfig);
                lastInvocationDetails = { model: candidate, mode: effectiveMode };
                return {
                    output,
                    model: candidate,
                    mode: effectiveMode,
                };
            } catch (error) {
                attempts.push({ model: candidate, error });
            }
        }

        const detail = attempts
            .map(({ model: candidate, error }) => `${candidate}: ${error?.message || error}`)
            .join('; ');

        const aggregatedError = new Error(detail ? `All model invocations failed: ${detail}` : 'All model invocations failed.');
        aggregatedError.attempts = attempts;
        aggregatedError.mode = selectionRequest.mode;
        aggregatedError.modelsTried = prioritized.slice();
        aggregatedError.configurationPath = modelsConfiguration.path || null;
        lastInvocationDetails = { model: null, mode: selectionRequest.mode };
        throw aggregatedError;
    };

    invokerStrategy.getSupportedModes = () => supportedModes.slice();
    invokerStrategy.listAvailableModels = () => ({
        fast: cachedModels.fast.map(record => ({ ...record })),
        deep: cachedModels.deep.map(record => ({ ...record })),
    });
    invokerStrategy.getLastInvocationDetails = () => ({ ...lastInvocationDetails });
    invokerStrategy.describe = () => ({
        configPath: modelsConfiguration.path || null,
        supportedModes: invokerStrategy.getSupportedModes(),
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
