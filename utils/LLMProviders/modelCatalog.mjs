import { loadModelsConfiguration } from './providers/modelsConfigLoader.mjs';

const modelsConfiguration = await loadModelsConfiguration();
let configurationDiagnosticsEmitted = false;

function emitConfigurationDiagnostics() {
    if (configurationDiagnosticsEmitted) {
        return;
    }
    configurationDiagnosticsEmitted = true;

    for (const error of modelsConfiguration.issues.errors) {
        if (process.env.LLMAgentClient_DEBUG === 'true') {
            console.error(`LLMAgentClient: ${error}`);
        }
    }
    for (const warning of modelsConfiguration.issues.warnings) {
        if (process.env.LLMAgentClient_DEBUG === 'true') {
            console.warn(`LLMAgentClient: ${warning}`);
        }
    }
}

function getModelsConfiguration() {
    return modelsConfiguration;
}

function getProviderConfig(providerKey) {
    return modelsConfiguration.providers.get(providerKey) || null;
}

function getModelDescriptor(modelName) {
    const descriptor = modelsConfiguration.models.get(modelName);
    if (descriptor) return descriptor;

    // Fallback: resolve via qualified names (handles promoted duplicate names)
    if (modelsConfiguration.qualifiedModels) {
        const resolved = modelsConfiguration.qualifiedModels.get(modelName);
        if (resolved) {
            return modelsConfiguration.models.get(resolved) || null;
        }
    }
    return null;
}

function createAgentModelRecord(providerConfig, modelDescriptor) {
    if (!providerConfig || !modelDescriptor) {
        return null;
    }

    const apiKeyEnv = modelDescriptor.apiKeyEnv || providerConfig.apiKeyEnv || null;
    const baseURL = modelDescriptor.baseURL || providerConfig.baseURL || null;

    return {
        name: modelDescriptor.name,
        providerKey: modelDescriptor.providerKey,
        apiKeyEnv,
        baseURL,
    };
}

function cloneAgentModelRecord(record) {
    return {
        name: record.name,
        providerKey: record.providerKey,
        apiKeyEnv: record.apiKeyEnv,
        baseURL: record.baseURL,
    };
}

function normalizeInvocationRequest(input) {
    if (typeof input === 'string') {
        const normalized = input.trim();
        return { modelName: normalized || null };
    }

    if (!input || typeof input !== 'object') {
        return { modelName: null };
    }

    const modelRaw = input.modelName || input.model || input.preferredModel;
    const modelName = typeof modelRaw === 'string' && modelRaw.trim() ? modelRaw.trim() : null;

    return { modelName };
}

function getOrderedModelNames() {
    if (Array.isArray(modelsConfiguration.orderedModels) && modelsConfiguration.orderedModels.length) {
        return modelsConfiguration.orderedModels.slice();
    }
    return Array.from(modelsConfiguration.models.keys());
}

function categorizeModelsByMode(modelNames) {
    return { models: normalizeModelNameList(modelNames) };
}

function buildModelRecordByName(modelName) {
    const descriptor = getModelDescriptor(modelName);
    if (!descriptor) {
        if (process.env.LLMAgentClient_DEBUG === 'true') {
            console.warn(`LLMAgentClient: LLMConfig.json does not define model "${modelName}".`);
        }
        return null;
    }
    const providerConfig = getProviderConfig(descriptor.providerKey);
    if (!providerConfig) {
        if (process.env.LLMAgentClient_DEBUG === 'true') {
            console.warn(`LLMAgentClient: Model "${modelName}" references unknown provider "${descriptor.providerKey}".`);
        }
        return null;
    }
    return createAgentModelRecord(providerConfig, descriptor);
}

function dedupeRecordsByName(records) {
    const seen = new Set();
    const result = [];
    for (const record of records) {
        if (!record || !record.name) {
            continue;
        }
        if (seen.has(record.name)) {
            continue;
        }
        seen.add(record.name);
        result.push(record);
    }
    return result;
}

function normalizeModelNameList(list) {
    if (!Array.isArray(list)) {
        return [];
    }
    return list
        .map(value => (typeof value === 'string' ? value.trim() : ''))
        .filter(Boolean);
}

function resetModelCatalogForTests() {
    configurationDiagnosticsEmitted = false;
}

export {
    buildModelRecordByName,
    categorizeModelsByMode,
    cloneAgentModelRecord,
    createAgentModelRecord,
    dedupeRecordsByName,
    emitConfigurationDiagnostics,
    getModelDescriptor,
    getModelsConfiguration,
    getOrderedModelNames,
    getProviderConfig,
    normalizeInvocationRequest,
    normalizeModelNameList,
    resetModelCatalogForTests,
};
