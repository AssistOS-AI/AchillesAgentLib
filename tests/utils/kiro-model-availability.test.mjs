import { readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { callLLM } from '../../utils/LLMProviders/providers/openai.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..', '..');
const configPath = path.join(projectRoot, 'LLMConfig.json');
const PROMPT = 'Hello';

async function loadConfig() {
    const raw = await readFile(configPath, 'utf8');
    return JSON.parse(raw);
}

function getKiroModels(config) {
    const names = (config?.models || [])
        .filter(entry => entry?.provider === 'kiro')
        .map(entry => entry.name);
    return Array.from(new Set(names));
}

async function main() {
    const config = await loadConfig();
    const kiroConfig = config?.providers?.kiro;
    if (!kiroConfig) {
        console.error('Kiro provider config not found in LLMConfig.json');
        process.exit(1);
    }

    const apiKeyEnv = kiroConfig.apiKeyEnv || 'PROXY_API_KEY';
    const apiKey = process.env[apiKeyEnv];
    if (!apiKey) {
        console.error(`Missing API key. Please set ${apiKeyEnv}.`);
        process.exit(1);
    }

    const baseURL = kiroConfig.baseURL;
    const models = getKiroModels(config);
    console.log(`Testing ${models.length} Kiro models with prompt "${PROMPT}"...`);

    for (const model of models) {
        const chatContext = [{ role: 'user', content: PROMPT }];
        try {
            const output = await callLLM(chatContext, {
                model,
                apiKey,
                baseURL,
            });
            console.log(`✅ ${model}: ${output}`);
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