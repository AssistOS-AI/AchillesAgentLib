import test from 'node:test';
import assert from 'node:assert/strict';

import LightSOPLangInterpreter, { DefaultExecutionMonitor } from '../../lightSOPLang/index.mjs';
import MockLLMAgent from './mocks/MockLLMAgent.mjs';
import { createRegistry } from './helpers.mjs';

test('English scripts require an LLM agent', async () => {
    const englishScript = ['#!english', 'make something'].join('\n');

    const interpreter = new LightSOPLangInterpreter(englishScript, {
        executeCommand: async () => null,
        listCommands: () => [],
    });

    await assert.rejects(interpreter.ready, /LLMAgent is required/);
});

test('LLMAgent stops regenerating after max rounds while exposing prompt history', async () => {
    const prompts = [];
    const llmAgent = new MockLLMAgent((prompt) => {
        prompts.push(prompt);
        return [
            '@value emit stale',
            '@result validate $value',
        ].join('\n');
    });

    let attempts = 0;
    const registry = createRegistry(async (input, response) => {
        attempts += 1;
        const [command, ...parts] = input.split(' ');
        if (command === 'emit') {
            return response.success(parts[0] ?? '');
        }
        if (command === 'validate') {
            if (parts[0] === 'stale') {
                return response.fail('stale');
            }
            return response.success('ok');
        }
        throw new Error(`Unknown command ${command}`);
    }, [
        { name: 'emit', description: 'Emit literal' },
        { name: 'validate', description: 'Validate value' },
    ]);

    const englishScript = [
        '#!english',
        'Produce a value and ensure validation passes.',
    ].join('\n');

    const interpreter = new LightSOPLangInterpreter(englishScript, registry, {
        llmAgent,
        maxLlmaRounds: 2,
        executionMonitor: new DefaultExecutionMonitor({ failureLimit: 50 }),
    });

    await interpreter.ready;
    assert.equal(interpreter.getVarValue('result'), 'fail:stale');
    assert.equal(prompts.length, 2);
    assert.ok(attempts >= 1);
});
