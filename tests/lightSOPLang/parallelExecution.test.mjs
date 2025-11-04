import test from 'node:test';
import assert from 'node:assert/strict';

import LightSOPLangInterpreter from '../../lightSOPLang/index.mjs';
import { createRegistry } from './helpers.mjs';

test('LightSOPLang executes independent declarations in parallel per level', async () => {
    const starts = [];
    const pending = [];

    const executeCommand = ({ command, args }, response) => {
        if (command === 'asyncTask') {
            starts.push(`async:${args[0]}`);
            return new Promise((resolve) => {
                pending.push({ label: args[0], resolve });
                if (pending.length === 2) {
                    const tasks = pending.splice(0, pending.length);
                    for (const task of tasks) {
                        const label = task.label;
                        task.resolve(response.success(`task-${label}`));
                    }
                }
            });
        }
        if (command === 'combine') {
            starts.push([command, ...args].join(' '));
            return Promise.resolve(response.success(args.join('&')));
        }
        throw new Error(`Unknown command ${command}`);
    };

    const code = [
        '@first asyncTask 1',
        '@second asyncTask 2',
        '@final combine $first $second',
    ].join('\n');

    const registry = createRegistry(executeCommand, [
        { name: 'asyncTask', description: 'Runs async task returning value' },
        { name: 'combine', description: 'Aggregates results using & delimiter' },
    ]);

    const interpreter = new LightSOPLangInterpreter(code, registry);
    await interpreter.ready;

    assert.deepEqual(starts, [
        'async:1',
        'async:2',
        'combine task-1 task-2',
    ]);

    assert.equal(interpreter.getVarValue('first'), 'task-1');
    assert.equal(interpreter.getVarValue('second'), 'task-2');
    assert.equal(interpreter.getVarValue('final'), 'task-1&task-2');
});
