import test from 'node:test';
import assert from 'node:assert/strict';

import LightSOPLangInterpreter from '../../lightSOPLang/index.mjs';
import { createRegistry } from './helpers.mjs';

test('assign command builds values from literals and variables', async () => {
    const registry = createRegistry(async () => {
        throw new Error('Unexpected external command call');
    }, []);

    const code = [
        '@first assign',
        '--begin-token-one--',
        'hello',
        '--end-token-one--',
        '@second assign "prefix" $first',
        '@third assign $second "tail"',
        '@multiline assign',
        '--begin-token-two--',
        'line1',
        'line2',
        '--end-token-two--',
        '@clean assign',
        'plain multiline',
        'without markers',
    ].join('\n');

    const interpreter = new LightSOPLangInterpreter(code, registry);
    await interpreter.ready;

    assert.equal(interpreter.getVarValue('first'), 'hello');
    assert.equal(interpreter.getVarValue('second'), 'prefix hello');
    assert.equal(interpreter.getVarValue('third'), 'prefix hello tail');
    assert.equal(interpreter.getVarValue('multiline'), 'line1\nline2');
    assert.equal(interpreter.getVarValue('clean'), 'plain multiline\nwithout markers');
});
