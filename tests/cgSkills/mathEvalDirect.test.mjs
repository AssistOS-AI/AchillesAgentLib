import test from 'node:test';
import assert from 'node:assert/strict';

import { LLMAgent } from '../../LLMAgents/index.mjs';
import { action as mathEvalAction } from './.AchillesSkills/test1/mathEval/mathEval.js';

function createAgent() {
    const codePayload = JSON.stringify({
        code: [
            'const numbers = [10, 20, 30];',
            'const total = numbers.reduce((sum, value) => sum + value, 0);',
            'return `Sum of 10, 20, and 30 is ${total}.`;',
        ].join('\n'),
        summary: 'Computed the requested sum.',
    });

    return new LLMAgent({
        name: 'TestMathEvalLLM',
        invokerStrategy: async ({ prompt, context }) => {
            if (typeof prompt === 'string' && prompt.includes('Return OK')) {
                return 'OK';
            }
            if (context?.intent === 'code-synthesis') {
                return codePayload;
            }
            return 'Fallback response';
        },
    });
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
