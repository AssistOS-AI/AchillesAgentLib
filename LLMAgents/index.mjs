import { LLMAgent, DEFAULT_AGENT_NAME } from './LLMAgent.mjs';
import { LLMAgentRegistry, llmAgentRegistry } from './LLMAgentRegistry.mjs';
import {
    extractKeyValuePairs,
    extractIdeaList,
    classifyIntent,
    responseToJSON,
} from './markdown.mjs';
import { envAutoConfig } from './envAutoConfig.mjs';
import { defaultLLMInvokerStrategy } from '../utils/LLMClient.mjs';

const DEBUG_ENABLED = process.env.ACHILES_DEBUG === '1' || process.env.ACHILES_DEBUG === 'true';

const envReport = envAutoConfig();
if (DEBUG_ENABLED && envReport.loaded) {
    const appliedCount = Object.keys(envReport.variables || {}).length;
    console.info(`[AchillesAgentsLib] Environment auto-config applied ${appliedCount} key(s).`);
}

try {
    if (DEBUG_ENABLED && defaultLLMInvokerStrategy && typeof defaultLLMInvokerStrategy.describe === 'function') {
        const description = defaultLLMInvokerStrategy.describe();
        if (description) {
            const modes = Array.isArray(description.supportedModes) && description.supportedModes.length
                ? description.supportedModes.join(', ')
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

export {
    LLMAgent,
    DEFAULT_AGENT_NAME,
    LLMAgentRegistry,
    llmAgentRegistry,
    extractKeyValuePairs,
    extractIdeaList,
    classifyIntent,
    responseToJSON,
    envAutoConfig,
};
