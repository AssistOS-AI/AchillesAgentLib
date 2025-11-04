import test from 'node:test';
import assert from 'node:assert/strict';

import LightSOPLangInterpreter from '../../lightSOPLang/index.mjs';
import { createRegistry } from './helpers.mjs';

test('LightSOPLang recovers from canceled state after dependency re-executes', async () => {
    const modeDecisions = ['cancel', 'success'];
    const history = [];

    const executeCommand = async ({ command, args }, response) => {
        history.push([command, ...args].join(' '));
        if (command === 'mode') {
            const decision = modeDecisions.shift() ?? 'success';
            if (decision === 'cancel') {
                return response.cancel('not ready');
            }
            return response.success('ready');
        }
        if (command === 'task') {
            return response.success(`run-${args.join('-')}`);
        }
        throw new Error(`Unknown command ${command}`);
    };

    const code = [
        '@mode mode initial',
        '@job task $mode payload',
    ].join('\n');

    const registry = createRegistry(executeCommand, [
        { name: 'mode', description: 'Determines readiness' },
        { name: 'task', description: 'Runs main job' },
    ]);

    const interpreter = new LightSOPLangInterpreter(code, registry);
    await interpreter.ready;

    assert.equal(
        interpreter.getVarValue('mode'),
        'canceled:command mode canceled (not ready)',
    );
    assert.equal(
        interpreter.getVarValue('job'),
        'canceled:because command mode canceled (not ready) via mode',
    );

    interpreter.updateCode(code);
    await interpreter.ready;

    assert.equal(interpreter.getVarValue('mode'), 'ready');
    assert.equal(interpreter.getVarValue('job'), 'run-ready-payload');

    const modeCalls = history.filter(entry => entry.startsWith('mode'));
    assert.equal(modeCalls.length, 2);
});

test('LightSOPLang restores canceled variable after code update changes command', async () => {
    const history = [];

    const executeCommand = async ({ command, args }, response) => {
        history.push([command, ...args].join(' '));
        if (command === 'emit') {
            return response.success(args[0] ?? '');
        }
        if (command === 'cancel') {
            return response.cancel('forced cancel');
        }
        if (command === 'combine') {
            return response.success(args.join('|'));
        }
        throw new Error(`Unknown command ${command}`);
    };

    const initialCode = [
        '@controller cancel value',
        '@result combine $controller suffix',
    ].join('\n');

    const registry = createRegistry(executeCommand, [
        { name: 'emit', description: 'Outputs a literal' },
        { name: 'cancel', description: 'Cancels with reason' },
        { name: 'combine', description: 'Concatenates args with |' },
    ]);

    const interpreter = new LightSOPLangInterpreter(initialCode, registry);
    await interpreter.ready;

    assert.equal(
        interpreter.getVarValue('controller'),
        'canceled:command cancel canceled (forced cancel)',
    );
    assert.equal(
        interpreter.getVarValue('result'),
        'canceled:because command cancel canceled (forced cancel) via controller',
    );

    const updatedCode = [
        '@controller emit value',
        '@result combine $controller suffix',
    ].join('\n');
    interpreter.updateCode(updatedCode);
    await interpreter.ready;

    assert.equal(interpreter.getVarValue('controller'), 'value');
    assert.equal(interpreter.getVarValue('result'), 'value|suffix');
});
