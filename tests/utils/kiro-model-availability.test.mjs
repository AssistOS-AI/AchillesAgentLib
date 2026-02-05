import '../envSetup.mjs';
import { loadModelsConfiguration } from '../../utils/LLMProviders/providers/modelsConfigLoader.mjs';
import { callLLM } from '../../utils/LLMProviders/providers/openai.mjs';

const PROMPT = 'Hello';

async function main() {
    const config = loadModelsConfiguration();
    
    // Look for axiologic_kiro provider (from .env)
    const kiroConfig = config.providers.get('axiologic_kiro');
    if (!kiroConfig) {
        console.error('Kiro provider config not found (check .env for OPENAI_AXIOLOGIC_KIRO_*)');
        process.exit(1);
    }

    const apiKeyEnv = kiroConfig.apiKeyEnv || 'AXIOLOGIC_API_KEY';
    const apiKey = process.env[apiKeyEnv];
    if (!apiKey) {
        console.error(`Missing API key. Please set ${apiKeyEnv}.`);
        process.exit(1);
    }

    const baseURL = kiroConfig.baseURL;
    
    // Get models for axiologic_kiro provider
    const kiroModels = config.providerModels.get('axiologic_kiro') || [];
    const modelNames = kiroModels.map(m => m.name);
    
    console.log(`Testing ${modelNames.length} Kiro models with prompt "${PROMPT}"...`);

    for (const model of modelNames) {
        const chatContext = [{ role: 'user', content: PROMPT }];
        try {
            const output = await callLLM(chatContext, {
                model,
                apiKey,
                baseURL,
            });
            console.log(`✅ ${model}: ${output?.slice(0, 100)}`);
        } catch (error) {
            console.error(`❌ ${model}: ${error.message}`);
            process.exitCode = 1;
        }
    }
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
