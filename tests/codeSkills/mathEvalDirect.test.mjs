import test from 'node:test';
import assert from 'node:assert/strict';

import { LLMAgent } from '../../LLMAgents/index.mjs';
import { action as mathEvalAction } from './.AchillesSkills/test1/mathEval/mathEval.js';

function createAgent() {
    return new LLMAgent();
}

test('mathEval action executes generated code', async (t) => {
    const llmAgent = createAgent();

    try {
        await llmAgent.executePrompt('Return OK', { mode: 'fast' });
    } catch (error) {
        const message = error?.message ? String(error.message) : 'Unknown LLM error';
        console.error(`[mathEvalDirect.test] LLM unavailable: ${message}`);
        t.skip(`LLM invocation unavailable: ${message}`);
        return;
    }

    const instruction = 'Compute the sum of 10, 20, and 30 and return the result as text.';
    const result = await mathEvalAction(instruction, {
        llmAgent,
        prompt: 'Return a concise explanation with the numeric result.',
        skillName: 'math-expression-evaluator-code',
    });

    assert.equal(typeof result, 'string');
    assert.ok(result.toLowerCase().includes('60'), 'expected result to mention 60');
});
