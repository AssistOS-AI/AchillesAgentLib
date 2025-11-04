import test from 'node:test';
import assert from 'node:assert/strict';

import LightSOPLangInterpreter from '../../lightSOPLang/index.mjs';
import { createSuccessValue } from '../../lightSOPLang/valueHelpers.mjs';
import { createRegistry } from './helpers.mjs';

test('LightSOPLang propagates cancellations triggered by dependency timestamp refresh', async () => {
    const history = [];
    let transformCalls = 0;

    const executeCommand = async ({ command, args }, response) => {
        history.push([command, ...args].join(' '));
        if (command === 'emit') {
            return response.success(args[0] ?? '');
        }
        if (command === 'transform') {
            transformCalls += 1;
            if (transformCalls >= 2) {
                return response.cancel('maintenance window');
            }
            return response.success(args.join('|'));
        }
        if (command === 'wrap') {
            return response.success(`[${args.join(',')}]`);
        }
        throw new Error(`Unknown command ${command}`);
    };

    const code = [
        '@source emit base',
        '@middle transform $source extra',
        '@final wrap $middle tail',
    ].join('\n');

    const registry = createRegistry(executeCommand, [
        { name: 'emit', description: 'Emit literal value' },
        { name: 'transform', description: 'Combine inputs, may cancel' },
        { name: 'wrap', description: 'Wrap values in array notation' },
    ]);

    const interpreter = new LightSOPLangInterpreter(code, registry);
    await interpreter.ready;

    assert.equal(interpreter.getVarValue('middle'), 'base|extra');
    assert.equal(interpreter.getVarValue('final'), '[base|extra,tail]');

    // Force the source to refresh with a newer timestamp to trigger recalculation.
    const refreshedValue = createSuccessValue('base', 'test');
    interpreter.variables.get('source').value = refreshedValue;
    interpreter._scheduleRun();
    await interpreter.ready;

    assert.equal(
        interpreter.getVarValue('middle'),
        'canceled:command transform canceled (maintenance window)',
    );
    assert.match(
        interpreter.getVarValue('final'),
        /^canceled:because command transform canceled \(maintenance window\) via middle/,
    );

    const transformExecutions = history.filter(entry => entry.startsWith('transform'));
    assert.equal(transformExecutions.length, 2);
    assert.ok(history.includes('wrap base|extra tail'));
});
