import test from 'node:test';
import assert from 'node:assert/strict';

import LightSOPLangInterpreter from '../../lightSOPLang/index.mjs';

test('LightSOPLang parser rejects duplicate variable declarations', async () => {
    const code = [
        '@value emit 1',
        '@value emit 2',
    ].join('\n');

    const interpreter = new LightSOPLangInterpreter(code, {
        executeCommand: async () => null,
        listCommands: () => [],
    });

    await assert.rejects(interpreter.ready, /declared multiple times/);
});

test('Comment parser keeps hashes inside quotes untouched', async () => {
    const interpreter = new LightSOPLangInterpreter([
        '@x emit "value#hash" # comment',
        "@y emit '#tag' # more comments",
    ].join('\n'), {
        executeCommand: async ({ args }, response) => {
            return response.success(args[0] ?? '');
        },
        listCommands: () => [{ name: 'emit', description: 'Return literal' }],
    });

    await interpreter.ready;
    assert.equal(interpreter.getVarValue('x'), 'value#hash');
    assert.equal(interpreter.getVarValue('y'), '#tag');
});
