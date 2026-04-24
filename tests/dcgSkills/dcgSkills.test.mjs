import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { LLMAgent } from '../../LLMAgents/index.mjs';
import { MainAgent } from '../../MainAgent/index.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function createTestLLMAgent() {
    return new LLMAgent();
}

const shared = {
    initialized: false,
    errorReason: null,
    mainAgent: null,
};

async function initializeMainAgent() {
    if (shared.initialized) {
        return shared;
    }

    shared.initialized = true;

    const llmAgent = createTestLLMAgent();
    try {
        await llmAgent.executePrompt('Return OK', { tier: 'fast' });
    } catch (error) {
        const attempts = Array.isArray(error?.attempts) ? error.attempts : [];
        const onlyMissingKeys = attempts.length > 0
            && attempts.every((attempt) => {
                const message = String(attempt?.error?.message || attempt?.error || '')
                    .toLowerCase();
                return message.includes('missing api key');
            });

        shared.errorReason = onlyMissingKeys
            ? 'No provider API key found in environment or .env chain.'
            : (error?.message ? String(error.message) : 'LLM invocation failed.');
        return shared;
    }

    shared.mainAgent = new MainAgent({
        startDir: __dirname,
        llmAgentOptions: {
            invokerStrategy: llmAgent.invokerStrategy,
        },
    });

    return shared;
}

async function ensureAgent(t) {
    await initializeMainAgent();
    if (!shared.mainAgent) {
        const reason = shared.errorReason || 'LLM invocation unavailable.';
        console.error(`[dcgSkills.test] LLM unavailable: ${reason}`);
        t.skip(`LLM invocation unavailable: ${reason}`);
        return null;
    }
    return shared.mainAgent;
}

test('Proofread code skill polishes input text', async (t) => {
    const mainAgent = await ensureAgent(t);
    if (!mainAgent) {
        return;
    }

    try {
        console.info('[dcgSkills.test] invoking proofread skill');
        const result = await mainAgent.executeSkill(
            'proofread-dynamic-code-generation',
            'Proofread the following sentence so it sounds natural: THIS is A TesT',
        );

        assert.equal(result.skill, 'proofread-dynamic-code-generation');
        console.info('[dcgSkills.test] proofread result:', result.result);
        assert.equal(result.preparedConfig.type, 'dynamic-code-generation');
        assert.ok(result.preparedConfig.llmModel);
        const normalized = result.result.trim().toLowerCase();
        assert.ok(normalized.startsWith('this is a test'));
    } catch (error) {
        console.error('Test failure diagnostic:', error);
        throw error;
    }
});

test('Large number multiplication uses code execution', async (t) => {
    const mainAgent = await ensureAgent(t);
    if (!mainAgent) {
        return;
    }

    try {
        console.info('[dcgSkills.test] invoking multiply skill');
        const result = await mainAgent.executeSkill(
            'bigmultiply-dynamic-code-generation',
            'Multiply 98765432123456789 by 123456789987654321 and return the exact result.',
        );

        assert.equal(result.skill, 'bigmultiply-dynamic-code-generation');
        console.info('[dcgSkills.test] multiply result:', result.result);
        assert.equal(result.preparedConfig.type, 'dynamic-code-generation');
        assert.ok(result.preparedConfig.llmModel);
        assert.ok(result.result.includes('12193263211705532552354824112635269'));
    } catch (error) {
        console.error('Test failure diagnostic:', error);
        throw error;
    }
});

test('Math evaluator computes arithmetic mean with generated code', async (t) => {
    const mainAgent = await ensureAgent(t);
    if (!mainAgent) {
        return;
    }

    try {
        console.info('[dcgSkills.test] invoking math skill');
        const result = await mainAgent.executeSkill(
            'matheval-dynamic-code-generation',
            'Calculate the arithmetic mean of the first five odd numbers.',
        );

        assert.equal(result.skill, 'matheval-dynamic-code-generation');
        console.info('[dcgSkills.test] math result:', result.result);
        assert.equal(result.preparedConfig.type, 'dynamic-code-generation');
        assert.ok(result.preparedConfig.llmModel);
        assert.ok(typeof result.result === 'string');
        assert.ok(result.result && result.result.length > 0);
        const normalized = result.result.toLowerCase();
        assert.ok(normalized.includes('mean'), 'math result should mention the mean computation');
        assert.ok(/\d/.test(result.result));
    } catch (error) {
        console.error('Test failure diagnostic:', error);
        throw error;
    }
});
