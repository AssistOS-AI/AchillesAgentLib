import test from 'node:test';
import assert from 'node:assert/strict';

import LightSOPLangInterpreter from '../../lightSOPLang/index.mjs';
import { createRegistry } from './helpers.mjs';

test('LightSOPLang propagates undefined states to dependents', async (t) => {
    const history = [];

    const executeCommand = async ({ command, args }, response) => {
        history.push([command, ...args].join(' '));
        if (command === 'emit') {
            return response.success(args[0] ?? '');
        }
        if (command === 'combine') {
            return response.success(args.join('-'));
        }
        if (command === 'off') {
            return undefined;
        }
        throw new Error(`Unknown command ${command}`);
    };

    const initialCode = [
        '@source emit base',
        '@dependent combine $source extra',
    ].join('\n');

    const registry = createRegistry(executeCommand, [
        { name: 'emit', description: 'Emit literal' },
        { name: 'combine', description: 'Join tokens with -' },
        { name: 'off', description: 'Return undefined to skip execution' },
    ]);

    const interpreter = new LightSOPLangInterpreter(initialCode, registry);
    await interpreter.ready;

    assert.equal(interpreter.getVarValue('source'), 'base');
    assert.equal(interpreter.getVarValue('dependent'), 'base-extra');
    assert.deepEqual(history, [
        'emit base',
        'combine base extra',
    ]);

    history.length = 0;

    const updatedCode = [
        '@source off base',
        '@dependent combine $source extra',
    ].join('\n');
    interpreter.updateCode(updatedCode);
    await interpreter.ready;

    await t.test('dependent variables become undefined if a prerequisite turns undefined', () => {
        assert.match(interpreter.getVarValue('source'), /^undefined(?::|$)/);
        assert.match(interpreter.getVarValue('dependent'), /^undefined(?::|$)/);
    });

    await t.test('commands with unmet dependencies are not executed', () => {
        assert.deepEqual(history, ['off base']);
    });
});
