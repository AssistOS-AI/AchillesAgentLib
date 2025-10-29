import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { LLMAgent } from '../../LLMAgents/index.mjs';
import { SkilledAgent } from '../../SkilledAgents/SkilledAgent.mjs';
import { RecursiveSkilledAgent } from '../../RecursiveSkilledAgents/RecursiveSkilledAgent.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


function createTestAgent() {
    const llmAgent = new LLMAgent({mame:"testAgent"});
    return new SkilledAgent({
        llmAgent,
        promptReader: async () => 'accept',
    });
}

test('Code skills execute external JavaScript and default prompt handlers', async (t) => {
    try {
        const skilledAgent = createTestAgent();
        try {
            await skilledAgent.llmAgent.complete({ prompt: 'Return OK', mode: 'fast' });
        } catch (error) {
            const attempts = Array.isArray(error?.attempts) ? error.attempts : [];
            const onlyMissingKeys = attempts.length > 0
                && attempts.every((attempt) => {
                    const message = String(attempt?.error?.message || attempt?.error || '')
                        .toLowerCase();
                    return message.includes('missing api key');
                });

            const reason = onlyMissingKeys
                ? 'No provider API key found in environment or .env chain.'
                : (error?.message ? String(error.message) : 'LLM invocation failed.');

            console.error(`[codeSkills.test] LLM unavailable: ${reason}`);
            t.skip(`LLM invocation unavailable: ${reason}`);
            return;
        }
        const startDir = __dirname;

        const subsystem = new CodeSkillsSubsystem({ skilledAgent });
        

        console.info('[codeSkills.test] invoking proofread skill');
        const proofreadResult = await subsystem.executePrompt(
            'Proofread the following sentence so it sounds natural: THIS is A TesT',
            {
                args: { input: 'THIS is A TesT' },
                skillName: 'proofread-polisher-code',
            },
        );

        assert.equal(proofreadResult.skill, 'proofread-polisher-code');
        console.info('[codeSkills.test] proofread result:', proofreadResult.result);
        assert.equal(proofreadResult.metadata.type, 'code');
        const normalizedProof = proofreadResult.result.trim().toLowerCase();
        assert.ok(normalizedProof.startsWith('this is a test'));

        console.info('[codeSkills.test] invoking multiply skill');
        const multiplyResult = await subsystem.executePrompt(
            'Multiply 98765432123456789 by 123456789987654321 and return the exact result.',
            {
                skillName: 'large-number-multiplier-code',
            },
        );

        assert.equal(multiplyResult.skill, 'large-number-multiplier-code');
        console.info('[codeSkills.test] multiply result:', multiplyResult.result);
        assert.equal(multiplyResult.metadata.type, 'code');
        assert.ok(multiplyResult.result.includes('12193263211705532552354824112635269'));

        console.info('[codeSkills.test] invoking math skill');
        const mathResult = await subsystem.executePrompt(
            'Calculate the arithmetic mean of the first five Fibonacci numbers starting from 8.',
            {
                skillName: 'math-expression-evaluator-code',
            },
        );

        assert.equal(mathResult.skill, 'math-expression-evaluator-code');
        console.info('[codeSkills.test] math result:', mathResult.result);
        assert.equal(mathResult.metadata.type, 'code');
        assert.ok(typeof mathResult.result === 'string');
        assert.ok(mathResult.result && mathResult.result.length > 0);
        assert.ok(mathResult.result.toLowerCase().includes('average'));
        assert.ok(/\d/.test(mathResult.result));

    } catch (error) {
        console.error('Test failure diagnostic:', error);
        throw error;
    }
});
