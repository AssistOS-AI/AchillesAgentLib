import test from 'node:test';
import assert from 'node:assert/strict';

import LightSOPLangInterpreter from '../../lightSOPLang/index.mjs';
import { DefaultExecutionMonitor } from '../../lightSOPLang/executionMonitor.mjs';
import { createRegistry } from './helpers.mjs';
import MockLLMAgent from './mocks/MockLLMAgent.mjs';

test('ExecutionMonitor stops after command budget exhausted', async () => {
    const monitor = new DefaultExecutionMonitor({
        commandLimit: 2,
        promptCharLimit: 1_000_000,
        failureLimit: 10,
    });

    const executeCommand = async (input, response) => {
        const [command, ...parts] = input.split(' ');
        if (command === 'emit') {
            return response.success(parts[0] ?? '');
        }
        if (command === 'combine') {
            return response.success(parts.join('+'));
        }
        throw new Error(`Unknown command ${command}`);
    };

    const registry = createRegistry(executeCommand, [
        { name: 'emit', description: 'Emit literal value' },
        { name: 'combine', description: 'Combine tokens with +' },
    ]);

    const code = [
        '@a emit 1',
        '@b emit 2',
        '@sum combine $a $b',
        '@final combine $sum tail',
    ].join('\n');

    const interpreter = new LightSOPLangInterpreter(code, registry, {
        executionMonitor: monitor,
    });

    await assert.rejects(interpreter.ready, /command budget exceeded/);

    const stats = monitor.getStats();
    assert.equal(stats.commandsExecuted, 3);
    assert.ok(stats.lastCommand.commandName.length);
});

const limitedPromptKey = ({ request }) => `${request.reason}:${request.attempt}`;

test('ExecutionMonitor prevents oversized prompt regeneration', async () => {
    const monitor = new DefaultExecutionMonitor({
        commandLimit: 100,
        promptCharLimit: 50,
        failureLimit: 10,
    });

    const registry = createRegistry(async (input, response) => response.success('ok'), [
        { name: 'emit', description: 'Emit literal' },
    ]);

    const englishScript = [
        '#!english',
        'Create a very verbose script that should exceed the prompt limit when combined with metadata.',
        'Repeat this description so it becomes sufficiently long to trip the guard.',
        'Include various instructions about dependencies, error handling, and output formatting.',
    ].join('\n');

    const llmAgent = new MockLLMAgent({
        'initial:0': '@value emit ok',
    }, limitedPromptKey);

    const interpreter = new LightSOPLangInterpreter(englishScript, registry, {
        llmAgent,
        executionMonitor: monitor,
    });

    await assert.rejects(interpreter.ready, /prompt budget exceeded/);

    const stats = monitor.getStats();
    assert.equal(stats.promptsConsidered, 1);
});

test('ExecutionMonitor aborts after repeated failures', async () => {
    const monitor = new DefaultExecutionMonitor({
        commandLimit: 100,
        promptCharLimit: 100_000,
        failureLimit: 2,
    });

    const executeCommand = async (input, response) => {
        const [command, ...parts] = input.split(' ');
        if (command === 'failer') {
            return response.fail(`fail-${parts.join('-')}`);
        }
        throw new Error(`Unexpected command ${command}`);
    };

    const registry = createRegistry(executeCommand, [
        { name: 'failer', description: 'Always fails for testing' },
    ]);

    const interpreter = new LightSOPLangInterpreter('@x failer first', registry, {
        executionMonitor: monitor,
    });

    await interpreter.ready;
    assert.equal(interpreter.getVarValue('x'), 'fail:fail-first');

    await interpreter.updateCode('@x failer second');
    await interpreter.ready;

    await assert.rejects(interpreter.updateCode('@x failer third'), /failure limit exceeded/);

    const stats = monitor.getStats();
    assert.equal(stats.failureCounts.failer, 3);
    assert.equal(stats.lastFailure.commandName, 'failer');
});

test('ExecutionMonitor statistics capture execution data', async () => {
    const monitor = new DefaultExecutionMonitor({
        commandLimit: 10,
        promptCharLimit: 1_000_000,
        failureLimit: 5,
    });

    const executeCommand = async (input, response) => {
        const [command, ...parts] = input.split(' ');
        if (command === 'emit') {
            return response.success(parts[0] ?? '');
        }
        if (command === 'combine') {
            return response.success(parts.join('|'));
        }
        throw new Error(`Unknown command ${command}`);
    };

    const registry = createRegistry(executeCommand, [
        { name: 'emit', description: 'Emit literal value' },
        { name: 'combine', description: 'Join strings with |' },
    ]);

    const code = [
        '@a emit alpha',
        '@b emit beta',
        '@combo combine $a $b',
    ].join('\n');

    const interpreter = new LightSOPLangInterpreter(code, registry, {
        executionMonitor: monitor,
    });

    await interpreter.ready;

    const stats = monitor.getStats();
    assert.equal(stats.commandsExecuted, 3);
    assert.equal(stats.failureCounts.failer, undefined);
    assert.equal(stats.lastCommand.commandName, 'combine');
});
