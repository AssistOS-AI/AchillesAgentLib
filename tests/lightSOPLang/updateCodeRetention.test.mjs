import test from 'node:test';
import assert from 'node:assert/strict';

import LightSOPLangInterpreter from '../../lightSOPLang/index.mjs';
import { createRegistry } from './helpers.mjs';

test('LightSOPLang updateCode retains values for unchanged declarations', async (t) => {
    const history = [];

    const executeCommand = async ({ command, args }, response) => {
        history.push([command, ...args].join(' '));
        if (command === 'emit') {
            return response.success(args[0] ?? '');
        }
        if (command === 'combine') {
            const [left, right] = args;
            return response.success(`${left}|${right}`);
        }
        throw new Error(`Unknown command ${command}`);
    };

    const initialCode = [
        '@source emit base',
        '@dependent combine $source extra',
    ].join('\n');

    const registry = createRegistry(executeCommand, [
        { name: 'emit', description: 'Emit literal' },
        { name: 'combine', description: 'Join values using |' },
    ]);

    const interpreter = new LightSOPLangInterpreter(initialCode, registry);
    await interpreter.ready;

    assert.equal(interpreter.getVarValue('source'), 'base');
    assert.equal(interpreter.getVarValue('dependent'), 'base|extra');
    assert.deepEqual(history, [
        'emit base',
        'combine base extra',
    ]);

    history.length = 0;

    const extendedCode = [
        '@source emit base',
        '@dependent combine $source extra',
        '@aux emit aux',
    ].join('\n');
    interpreter.updateCode(extendedCode);
    await interpreter.ready;

    await t.test('unchanged declarations keep their previous successful values', () => {
        assert.equal(interpreter.getVarValue('source'), 'base');
        assert.equal(interpreter.getVarValue('dependent'), 'base|extra');
    });

    await t.test('new declarations are executed without re-running unaffected ones', () => {
        assert.deepEqual(history, ['emit aux']);
    });
});
