import { LLMAgent, DEFAULT_AGENT_NAME } from './LLMAgent.mjs';
import { LLMAgentRegistry, llmAgentRegistry } from './LLMAgentRegistry.mjs';
import {
    extractKeyValuePairs,
    extractIdeaList,
    classifyIntent,
    responseToJSON,
} from './markdown.mjs';
import { defaultLLMInvokerStrategy } from '../utils/LLMClient.mjs';

const debugFlag = (process.env.ACHILLES_DEBUG ?? '').toLowerCase();
const DEBUG_ENABLED = debugFlag === '1' || debugFlag === 'true';

try {
    if (DEBUG_ENABLED && defaultLLMInvokerStrategy && typeof defaultLLMInvokerStrategy.describe === 'function') {
        const description = defaultLLMInvokerStrategy.describe();
        if (description) {
            const modes = Array.isArray(description.supportedTiers) && description.supportedTiers.length
                ? description.supportedTiers.join(', ')
                : 'unknown';

            const formatModels = (entries) => {
                if (!Array.isArray(entries) || !entries.length) {
                    return 'none';
                }
                const configured = entries
                    .filter((entry) => {
                        if (!entry || typeof entry !== 'object') {
                            return false;
                        }
                        const envKey = entry.apiKeyEnv;
                        if (!envKey) {
                            return true;
                        }
                        return Boolean(process.env[envKey]);
                    })
                    .map((entry) => entry.name);
                return configured.length ? configured.join(', ') : 'none';
            };

            const fastModels = formatModels(description.fastModels);
            const deepModels = formatModels(description.deepModels);

            console.info('[AchillesAgentsLib] Default LLM configuration:');
            if (description.configPath) {
                console.info(`[AchillesAgentsLib]   Config file: ${description.configPath}`);
            }
            console.info(`[AchillesAgentsLib]   Supported modes: ${modes}`);
            console.info(`[AchillesAgentsLib]   Fast models: ${fastModels}`);
            console.info(`[AchillesAgentsLib]   Deep models: ${deepModels}`);
        }
    }
} catch (error) {
    console.warn(`[AchillesAgentsLib] Failed to summarise default LLM configuration: ${error.message}`);
}

// Helper functions for LLM agent registry (backwards compatibility)
const registerLLMAgent = (config, options = {}) => llmAgentRegistry.register(config, options);
const registerDefaultLLMAgent = (config = {}) => llmAgentRegistry.registerDefault(config);
const getLLMAgent = (name) => llmAgentRegistry.get(name);
const getDefaultLLMAgent = () => llmAgentRegistry.getDefault();
const listLLMAgents = () => llmAgentRegistry.list();
const clearLLMAgents = () => llmAgentRegistry.clear();

export {
    LLMAgent,
    DEFAULT_AGENT_NAME,
    LLMAgentRegistry,
    llmAgentRegistry,
    extractKeyValuePairs,
    extractIdeaList,
    classifyIntent,
    responseToJSON,
    registerLLMAgent,
    registerDefaultLLMAgent,
    getLLMAgent,
    getDefaultLLMAgent,
    listLLMAgents,
    clearLLMAgents,
};
