import test from 'node:test';
import assert from 'node:assert/strict';

import LightSOPLangInterpreter from '../../lightSOPLang/index.mjs';
import { createRegistry } from './helpers.mjs';

test('LightSOPLang triggers onFail and blocks dependents after failures', async () => {
    const history = [];
    let recordedFailure = null;

    const executeCommand = async ({ command, args }, response) => {
        history.push([command, ...args].join(' '));
        if (command === 'emit') {
            return response.success(args[0] ?? '');
        }
        if (command === 'failer') {
            return response.fail('oops');
        }
        if (command === 'combine') {
            return response.success(args.join('_'));
        }
        throw new Error(`Unknown command ${command}`);
    };

    const onFail = (details) => {
        recordedFailure = details;
    };

    const code = [
        '@seed emit ok',
        '@broken failer $seed',
        '@later combine $broken tail',
    ].join('\n');

    const registry = createRegistry(executeCommand, [
        { name: 'emit', description: 'Returns provided literal' },
        { name: 'failer', description: 'Fails with reason' },
        { name: 'combine', description: 'Merges tokens with _' },
    ]);

    const interpreter = new LightSOPLangInterpreter(code, registry, onFail);
    await interpreter.ready;

    assert.equal(interpreter.getVarValue('seed'), 'ok');
    assert.equal(interpreter.getVarValue('broken'), 'fail:oops');
    assert.match(interpreter.getVarValue('later'), /^undefined(?::|$)/);

    assert.deepEqual(history, [
        'emit ok',
        'failer ok',
    ]);

    assert.deepEqual(recordedFailure, [
        { variable: 'broken', reason: 'fail:oops' },
    ]);
});
