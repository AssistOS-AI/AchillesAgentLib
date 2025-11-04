import test from 'node:test';
import assert from 'node:assert/strict';

import LightSOPLangInterpreter from '../../lightSOPLang/index.mjs';
import { createRegistry } from './helpers.mjs';

test('LightSOPLang propagates cancellations introduced by code updates', async () => {
    const history = [];

    const executeCommand = async ({ command, args }, response) => {
        history.push([command, ...args].join(' '));
        if (command === 'emit') {
            return response.success(args[0] ?? '');
        }
        if (command === 'guard') {
            const base = args[0] ?? '';
            return response.success(`${base}~`);
        }
        if (command === 'cancelAfterUpdate') {
            return response.cancel('manual override');
        }
        if (command === 'concat') {
            return response.success(args.join('+'));
        }
        throw new Error(`Unknown command ${command}`);
    };

    const initialCode = [
        '@source emit alpha',
        '@controller guard $source',
        '@final concat $controller omega',
    ].join('\n');

    const registry = createRegistry(executeCommand, [
        { name: 'emit', description: 'Emit literal token' },
        { name: 'guard', description: 'Decorate source with suffix' },
        { name: 'cancelAfterUpdate', description: 'Cancel execution for manual overrides' },
        { name: 'concat', description: 'Join tokens with +' },
    ]);

    const interpreter = new LightSOPLangInterpreter(initialCode, registry);
    await interpreter.ready;

    assert.equal(interpreter.getVarValue('controller'), 'alpha~');
    assert.equal(interpreter.getVarValue('final'), 'alpha~+omega');

    const updatedCode = [
        '@source emit alpha',
        '@controller cancelAfterUpdate $source',
        '@final concat $controller omega',
    ].join('\n');
    interpreter.updateCode(updatedCode);
    await interpreter.ready;

    assert.equal(
        interpreter.getVarValue('controller'),
        'canceled:command cancelAfterUpdate canceled (manual override)',
    );
    assert.match(
        interpreter.getVarValue('final'),
        /^canceled:because command cancelAfterUpdate canceled \(manual override\) via controller/,
    );

    const cancelExecutions = history.filter(entry => entry.startsWith('cancelAfterUpdate'));
    assert.equal(cancelExecutions.length, 1);
});
