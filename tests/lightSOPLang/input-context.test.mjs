import test from 'node:test';
import assert from 'node:assert/strict';

import LightSOPLangInterpreter from '../../lightSOPLang/index.mjs';
import { createRegistry } from './helpers.mjs';

test('LightSOPLang exposes supplied input as a success value', async () => {
    const history = [];

    const registry = createRegistry(async ({ command, args }, response) => {
        history.push([command, ...args].join(' '));
        if (command === 'echo') {
            return response.success(args[0]);
        }
        throw new Error(`Unexpected command ${command}`);
    }, [{ name: 'echo', description: 'Echo back input' }]);

    const interpreter = new LightSOPLangInterpreter('@result echo $input', registry, 'payload-value');
    await interpreter.ready;

    assert.equal(interpreter.getVarValue('result'), 'payload-value');
    assert.deepEqual(history, ['echo payload-value']);
});

test('LightSOPLang includes input context when generating english scripts', async () => {
    let capturedPrompt = '';

    const llmAgent = {
        executePrompt: async (prompt) => {
            capturedPrompt = prompt;
            return '@result emit $input';
        },
    };

    const registry = createRegistry(async ({ command, args }, response) => {
        if (command === 'emit') {
            return response.success(args[0]);
        }
        throw new Error(`Unexpected command ${command}`);
    }, [{ name: 'emit', description: 'Emit literal value' }]);

    const interpreter = new LightSOPLangInterpreter(
        '#!english\nReturn the provided input.',
        registry,
        'context-payload',
        { llmAgent },
    );

    await interpreter.ready;

    assert.match(capturedPrompt, /Input context:/);
    assert.ok(capturedPrompt.includes('context-payload'));
    assert.equal(interpreter.getVarValue('result'), 'context-payload');
});
