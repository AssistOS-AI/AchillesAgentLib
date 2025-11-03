import test from 'node:test';
import assert from 'node:assert/strict';

import LightSOPLangInterpreter from '../../lightSOPLang/index.mjs';
import { createRegistry } from './helpers.mjs';

test('Removing a variable from code clears dependents that reference it', async () => {
    const history = [];
    const registry = createRegistry(async (input, response) => {
        history.push(input);
        const [command, ...parts] = input.split(' ');
        if (command === 'emit') {
            return response.success(parts[0] ?? '');
        }
        if (command === 'combine') {
            return response.success(parts.join(':'));
        }
        throw new Error(`Unknown command ${command}`);
    }, [
        { name: 'emit', description: 'Emit literal' },
        { name: 'combine', description: 'Combine tokens' },
    ]);

    const initialCode = [
        '@a emit first',
        '@b emit second',
        '@pair combine $a $b',
    ].join('\n');

    const interpreter = new LightSOPLangInterpreter(initialCode, registry);
    await interpreter.ready;

    assert.equal(interpreter.getVarValue('pair'), 'first:second');
    history.length = 0;

    const updatedCode = [
        '@a emit first',
        '@pair combine $a $b',
    ].join('\n');

    await assert.rejects(interpreter.updateCode(updatedCode), /undefined variable b/);
});

test('Removing dependents keeps remaining variables cached', async () => {
    const registry = createRegistry(async (input, response) => response.success(input.split(' ')[1]), [
        { name: 'emit', description: 'Emit literal' },
    ]);

    const interpreter = new LightSOPLangInterpreter([
        '@a emit alpha',
        '@b emit beta',
    ].join('\n'), registry);
    await interpreter.ready;

    assert.equal(interpreter.getVarValue('a'), 'alpha');
    assert.equal(interpreter.getVarValue('b'), 'beta');

    interpreter.updateCode('@a emit alpha');
    await interpreter.ready;

    assert.equal(interpreter.getVarValue('a'), 'alpha');
    assert.equal(interpreter.getVarValue('b'), undefined);
});
