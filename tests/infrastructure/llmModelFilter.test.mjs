import test from 'node:test';
import assert from 'node:assert/strict';

test('LLM model caches respect ACHILLES_ENABLED_* allow lists', async () => {
    const previousFast = process.env.ACHILLES_ENABLED_FAST_MODELS;
    const previousDeep = process.env.ACHILLES_ENABLED_DEEP_MODELS;

    process.env.ACHILLES_ENABLED_FAST_MODELS = 'gpt-5-mini';
    process.env.ACHILLES_ENABLED_DEEP_MODELS = JSON.stringify(['gpt-5']);

    try {
        const modulePath = `../../utils/LLMClient.mjs?filter=${Date.now()}`;
        const { listModelsFromCache } = await import(modulePath);
        const { fast, deep } = listModelsFromCache();

        const fastNames = fast.map((record) => record.name).sort();
        const deepNames = deep.map((record) => record.name).sort();

        assert.deepStrictEqual(fastNames, ['gpt-5-mini'], 'Fast models should be limited by ACHILLES_ENABLED_FAST_MODELS');
        assert.deepStrictEqual(deepNames, ['gpt-5'], 'Deep models should be limited by ACHILLES_ENABLED_DEEP_MODELS');
    } finally {
        process.env.ACHILLES_ENABLED_FAST_MODELS = previousFast;
        process.env.ACHILLES_ENABLED_DEEP_MODELS = previousDeep;
    }
});
