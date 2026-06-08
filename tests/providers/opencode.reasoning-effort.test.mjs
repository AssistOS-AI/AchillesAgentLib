import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MainAgent } from '../../MainAgent/MainAgent.mjs';

const MODEL_NAME = 'opencode/deepseek-v4-flash';
const EFFORT_LEVELS = ['low', 'medium', 'high'];

function skipIfNoApiKey() {
    if (!process.env.OPENCODE_API_KEY) {
        console.log('Skipping: OPENCODE_API_KEY not set');
        return true;
    }
    return false;
}

test('opencode zen: deepseek-v4-flash reasoning_effort low, medium, high via MainAgent', async (t) => {
    if (skipIfNoApiKey()) return;

    for (const effort of EFFORT_LEVELS) {
        await t.test(`reasoningEffort=${effort}`, async () => {
            const agent = new MainAgent({
                startDir: process.cwd(),
                disableInternalSkills: true,
                reasoningEffort: effort,
            });

            const prompt = 'Say "reasoning effort test" in exactly three words.';
            console.log(`\n  [${effort}] INPUT prompt: "${prompt}"`);
            console.log(`  [${effort}] INPUT model: ${MODEL_NAME}`);
            console.log(`  [${effort}] INPUT reasoningEffort: ${effort}`);

            const result = await agent.executePrompt(prompt, {
                model: MODEL_NAME,
            });

            const text = result.result.trim();
            console.log(`  [${effort}] OUTPUT: "${text}"`);
            console.log(`  [${effort}] status: ${result.status}`);

            assert.ok(result && typeof result.result === 'string', `result must be a string for effort=${effort}`);
            assert.ok(text.length > 0, `response must not be empty for effort=${effort}`);
        });
    }
});

test('opencode zen: per-call reasoningEffort overrides constructor default', async (t) => {
    if (skipIfNoApiKey()) return;

    const agent = new MainAgent({
        startDir: process.cwd(),
        disableInternalSkills: true,
        reasoningEffort: 'low',
    });

    const prompt = 'Say "override test" in two words.';
    console.log(`\n  [constructor=low, call=high] INPUT prompt: "${prompt}"`);
    console.log(`  [constructor=low, call=high] INPUT model: ${MODEL_NAME}`);
    console.log(`  [constructor=low, call=high] INPUT reasoningEffort: high (override)`);

    const resultHigh = await agent.executePrompt(prompt, {
        model: MODEL_NAME,
        reasoningEffort: 'high',
    });

    const text = resultHigh.result.trim();
    console.log(`  [constructor=low, call=high] OUTPUT: "${text}"`);
    console.log(`  [constructor=low, call=high] status: ${resultHigh.status}`);

    assert.ok(resultHigh && typeof resultHigh.result === 'string', 'per-call override must work');
});

test('opencode zen: verify reasoning_effort is sent in request body', async (t) => {
    if (skipIfNoApiKey()) return;

    const originalFetch = globalThis.fetch;
    let capturedBody = null;
    let capturedUrl = null;

    globalThis.fetch = async (url, init) => {
        capturedUrl = url;
        capturedBody = JSON.parse(init.body);
        return originalFetch(url, init);
    };

    try {
        const agent = new MainAgent({
            startDir: process.cwd(),
            disableInternalSkills: true,
            reasoningEffort: 'high',
        });

        const prompt = 'Say hello.';
        console.log(`\n  [capture] INPUT prompt: "${prompt}"`);
        console.log(`  [capture] INPUT model: ${MODEL_NAME}`);
        console.log(`  [capture] INPUT reasoningEffort: high`);

        await agent.executePrompt(prompt, { model: MODEL_NAME });

        console.log(`  [capture] FETCH URL: ${capturedUrl}`);
        console.log(`  [capture] REQUEST BODY model: ${capturedBody.model}`);
        console.log(`  [capture] REQUEST BODY reasoning_effort: ${capturedBody.reasoning_effort}`);
        console.log(`  [capture] REQUEST BODY messages: ${JSON.stringify(capturedBody.messages)}`);

        assert.equal(capturedBody.reasoning_effort, 'high', 'reasoning_effort must be "high" in request body');
        assert.ok(
            capturedBody.model === 'deepseek-v4-flash' || capturedBody.model === MODEL_NAME,
            `model should be deepseek-v4-flash or the full reference; got: ${capturedBody.model}`,
        );
    } finally {
        globalThis.fetch = originalFetch;
    }
});
