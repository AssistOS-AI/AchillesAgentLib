import test from 'node:test';
import assert from 'node:assert/strict';

import LightSOPLangInterpreter from '../../lightSOPLang/index.mjs';
import { createRegistry } from './helpers.mjs';

test('LightSOPLang skips downstream execution when guard cancels', async () => {
    const history = [];

    const executeCommand = async ({ command, args }, response) => {
        history.push([command, ...args].join(' '));
        if (command === 'guard') {
            const flag = args[0];
            if (flag === 'off') {
                return response.cancel('guard disabled');
            }
            return response.success(flag);
        }
        if (command === 'task') {
            return response.success(args.join('|'));
        }
        if (command === 'finalize') {
            return response.success(`FINAL:${args.join(':')}`);
        }
        throw new Error(`Unknown command ${command}`);
    };

    const code = [
        '@feature guard off # comment should be ignored',
        '@taskA task $feature body',
        '@final finalize $taskA',
    ].join('\n');

    const registry = createRegistry(executeCommand, [
        { name: 'guard', description: 'Validates feature availability' },
        { name: 'task', description: 'Executes guarded task' },
        { name: 'finalize', description: 'Final assembly' },
    ]);

    const interpreter = new LightSOPLangInterpreter(code, registry);
    await interpreter.ready;

    assert.equal(
        interpreter.getVarValue('feature'),
        'canceled:command guard canceled (guard disabled)',
    );
    assert.equal(
        interpreter.getVarValue('taskA'),
        'canceled:because command guard canceled (guard disabled) via feature',
    );
    assert.equal(
        interpreter.getVarValue('final'),
        'canceled:because command guard canceled (guard disabled) via taskA',
    );

    const executedTasks = history.filter(entry => entry.startsWith('task'));
    const executedFinalize = history.filter(entry => entry.startsWith('finalize'));
    assert.equal(executedTasks.length, 0);
    assert.equal(executedFinalize.length, 0);
});
