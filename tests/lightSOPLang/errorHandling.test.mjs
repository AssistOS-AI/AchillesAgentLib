import test from 'node:test';
import assert from 'node:assert/strict';

import LightSOPLangInterpreter, { DefaultExecutionMonitor } from '../../lightSOPLang/index.mjs';

test('Exceptions thrown by executeCommand convert to failures and trigger monitor', async () => {
    const monitor = new DefaultExecutionMonitor({ failureLimit: 5 });
    let callCount = 0;

    const registry = {
        executeCommand: async () => {
            callCount += 1;
            throw new Error('boom');
        },
        listCommands: () => [{ name: 'boom', description: 'Always throws' }],
    };

    const interpreter = new LightSOPLangInterpreter('@x boom', registry, { executionMonitor: monitor });

    await interpreter.ready;
    assert.equal(interpreter.getVarValue('x'), 'fail:boom');
    assert.equal(callCount, 1);

    const stats = monitor.getStats();
    assert.equal(stats.failureCounts.boom, 1);
});

test('Commands returning non-value results mark variable undefined and can be retried', async () => {
    let mode = 0;
    const registry = {
        async executeCommand(input, response) {
            if (input.startsWith('noop')) {
                return response.success('noop');
            }
            if (mode === 0) {
                mode = 1;
                return null;
            }
            return response.success('ok');
        },
        listCommands: () => [
            { name: 'noop', description: 'No-op' },
            { name: 'task', description: 'Task with retry' },
        ],
    };

    const code = [
        '@ready noop token',
        '@task task $ready',
    ].join('\n');

    const interpreter = new LightSOPLangInterpreter(code, registry);
    await interpreter.ready;

    interpreter.updateCode(code);
    await interpreter.ready;

    assert.equal(interpreter.getVarValue('task'), 'ok');
});
