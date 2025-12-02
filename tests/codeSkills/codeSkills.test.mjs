import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { LLMAgent } from '../../LLMAgents/index.mjs';
import { RecursiveSkilledAgent } from '../../RecursiveSkilledAgents/RecursiveSkilledAgent.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function createTestLLMAgent() {
    return new LLMAgent();
}

const shared = {
    initialized: false,
    errorReason: null,
    recursiveAgent: null,
};

async function initializeRecursiveAgent() {
    if (shared.initialized) {
        return shared;
    }

    shared.initialized = true;

    const llmAgent = createTestLLMAgent();
    try {
        await llmAgent.executePrompt('Return OK', { mode: 'fast' });
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

    const startDir = path.join(__dirname, '..');
    shared.recursiveAgent = new RecursiveSkilledAgent({
        llmAgent,
        promptReader: async () => 'accept',
        startDir,
        skillFilter: ({ type }) => type === 'code',
    });

    return shared;
}

async function ensureAgent(t) {
    await initializeRecursiveAgent();
    if (!shared.recursiveAgent) {
        const reason = shared.errorReason || 'LLM invocation unavailable.';
        console.error(`[codeSkills.test] LLM unavailable: ${reason}`);
        t.skip(`LLM invocation unavailable: ${reason}`);
        return null;
    }
    return shared.recursiveAgent;
}

test('Proofread code skill polishes input text', async (t) => {
    const recursiveAgent = await ensureAgent(t);
    if (!recursiveAgent) {
        return;
    }

    try {
        console.info('[codeSkills.test] invoking proofread skill');
        const result = await recursiveAgent.executePrompt(
            'Proofread the following sentence so it sounds natural: THIS is A TesT',
            {
                args: { input: 'THIS is A TesT' },
                skillName: 'proofread-polisher-code',
            },
        );

        assert.equal(result.skill, 'proofread-polisher-code');
        console.info('[codeSkills.test] proofread result:', result.result);
        assert.equal(result.metadata.type, 'code');
        assert.equal(result.metadata.llmMode, 'fast');
        const normalized = result.result.trim().toLowerCase();
        assert.ok(normalized.startsWith('this is a test'));
    } catch (error) {
        console.error('Test failure diagnostic:', error);
        throw error;
    }
});

test('Large number multiplication uses code execution', async (t) => {
    const recursiveAgent = await ensureAgent(t);
    if (!recursiveAgent) {
        return;
    }

    try {
        console.info('[codeSkills.test] invoking multiply skill');
        const result = await recursiveAgent.executePrompt(
            'Multiply 98765432123456789 by 123456789987654321 and return the exact result.',
            {
                skillName: 'large-number-multiplier-code',
            },
        );

        assert.equal(result.skill, 'large-number-multiplier-code');
        console.info('[codeSkills.test] multiply result:', result.result);
        assert.equal(result.metadata.type, 'code');
        assert.equal(result.metadata.llmMode, 'fast');
        assert.ok(result.result.includes('12193263211705532552354824112635269'));
    } catch (error) {
        console.error('Test failure diagnostic:', error);
        throw error;
    }
});

test('Math evaluator computes arithmetic mean with generated code', async (t) => {
    const recursiveAgent = await ensureAgent(t);
    if (!recursiveAgent) {
        return;
    }

    try {
        console.info('[codeSkills.test] invoking math skill');
        const result = await recursiveAgent.executePrompt(
            'Calculate the arithmetic mean of the first five odd numbers.',
            {
                skillName: 'math-expression-evaluator-code',
            },
        );

        assert.equal(result.skill, 'math-expression-evaluator-code');
        console.info('[codeSkills.test] math result:', result.result);
        assert.equal(result.metadata.type, 'code');
        assert.equal(result.metadata.llmMode, 'deep');
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
