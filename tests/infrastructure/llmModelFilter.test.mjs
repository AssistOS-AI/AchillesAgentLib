import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function loadModelNames() {
    const configPath = path.resolve(__dirname, '../../LLMConfig.json');
    const raw = await fs.readFile(configPath, 'utf-8');
    const config = JSON.parse(raw);
    const models = Array.isArray(config.models) ? config.models : [];
    const fast = models.find((model) => model?.tier === 'fast')?.name || null;
    const deep = models.find((model) => model?.tier === 'deep')?.name || null;
    return { fast, deep };
}

test('LLM model caches respect ACHILLES_ENABLED_* allow lists', async (t) => {
    const { fast, deep } = await loadModelNames();
    if (!fast || !deep) {
        t.skip('No fast/deep models available in LLMConfig.json');
        return;
    }

    const previousFast = process.env.ACHILLES_ENABLED_FAST_MODELS;
    const previousDeep = process.env.ACHILLES_ENABLED_DEEP_MODELS;

    process.env.ACHILLES_ENABLED_FAST_MODELS = fast;
    process.env.ACHILLES_ENABLED_DEEP_MODELS = JSON.stringify([deep]);

    try {
        const modulePath = `../../utils/LLMClient.mjs?filter=${Date.now()}`;
        const { listModelsFromCache } = await import(modulePath);
        const { fast: fastModels, deep: deepModels } = listModelsFromCache();

        const fastNames = fastModels.map((record) => record.name).sort();
        const deepNames = deepModels.map((record) => record.name).sort();

        assert.deepStrictEqual(fastNames, [fast], 'Fast models should be limited by ACHILLES_ENABLED_FAST_MODELS');
        assert.deepStrictEqual(deepNames, [deep], 'Deep models should be limited by ACHILLES_ENABLED_DEEP_MODELS');
    } finally {
        process.env.ACHILLES_ENABLED_FAST_MODELS = previousFast;
        process.env.ACHILLES_ENABLED_DEEP_MODELS = previousDeep;
    }
});
