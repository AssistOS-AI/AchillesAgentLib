import test from 'node:test';
import assert from 'node:assert/strict';

import LightSOPLangInterpreter, { DefaultExecutionMonitor } from '../../lightSOPLang/index.mjs';
import MockLLMAgent from './mocks/MockLLMAgent.mjs';
import { createRegistry } from './helpers.mjs';

test('LLMAgent generated scripts iterate until success', async () => {
    const llmAgent = new MockLLMAgent((prompt) => {
        if (prompt.includes('Generate an initial script')) {
            return [
                '@seed emit base',
                '@broken failer $seed',
                '@result combine $broken done',
            ].join('\n');
        }
        if (prompt.includes('Attempt 1')) {
            return [
                '@seed emit base',
                '@result combine $seed done',
            ].join('\n');
        }
        throw new Error('Unexpected prompt content');
    });
    const monitor = new DefaultExecutionMonitor();

    const history = [];

    const executeCommand = async (input, response) => {
        history.push(input);
        const [command, ...parts] = input.split(' ');
        if (command === 'emit') {
            return response.success(parts[0] ?? '');
        }
        if (command === 'failer') {
            return response.fail('simulated failure');
        }
        if (command === 'combine') {
            return response.success(parts.join('+'));
        }
        throw new Error(`Unknown command ${command}`);
    };

    const englishScript = [
        '#!english',
        'Ensure we prepare a seed value and combine it with the word done.',
        'The initial attempt is expected to fail and trigger a refinement.',
    ].join('\n');

    const registry = createRegistry(executeCommand, [
        { name: 'emit', description: 'Emit literal' },
        { name: 'failer', description: 'Always fails for testing' },
        { name: 'combine', description: 'Concatenate inputs with +' },
    ]);

    const interpreter = new LightSOPLangInterpreter(englishScript, registry, {
        llmAgent,
        maxLlmaRounds: 5,
        executionMonitor: monitor,
    });

    await interpreter.ready;
    await interpreter.ready;

    assert.equal(interpreter.getVarValue('seed'), 'base');
    assert.equal(interpreter.getVarValue('result'), 'base+done');

    const stats = monitor.getStats();
    assert.equal(stats.promptsConsidered, 2);
    const [firstPrompt, secondPrompt] = stats.promptHistory;
    assert.equal(firstPrompt.request.reason, 'initial');
    assert.equal(secondPrompt.request.reason, 'failure');
    assert.equal(secondPrompt.request.failures[0].variable, 'broken');
    assert.equal(secondPrompt.request.failures[0].reason, 'fail:simulated failure');

    const variableNames = secondPrompt.request.variables.map(entry => entry.name);
    assert.deepEqual(variableNames.sort(), ['broken', 'result', 'seed']);

    assert.ok(Array.isArray(secondPrompt.request.commands));
    const commandNames = secondPrompt.request.commands.map(entry => entry.name).sort();
    assert.deepEqual(commandNames, ['combine', 'emit', 'failer']);

    const failerCalls = history.filter(entry => entry.startsWith('failer'));
    assert.equal(failerCalls.length, 1);

    assert.match(firstPrompt.prompt, /Ensure we prepare a seed value/);
    assert.match(secondPrompt.prompt, /Failures:/);
});

test('LLMAgent uses command catalog to pick supported operations', async () => {
    const llmAgent = new MockLLMAgent((prompt) => {
        if (prompt.includes('Generate an initial script')) {
            return [
                '@value emit 5',
                '@result multiply $value 2',
            ].join('\n');
        }
        if (prompt.includes('Attempt 1')) {
            return [
                '@value emit 5',
                '@result combine $value 2',
            ].join('\n');
        }
        throw new Error('Unexpected prompt content');
    });
    const monitor = new DefaultExecutionMonitor();

    const executeCommand = async (input, response) => {
        const [command, ...parts] = input.split(' ');
        if (command === 'emit') {
            return response.success(parts[0] ?? '');
        }
        if (command === 'combine') {
            return response.success(parts.join('*'));
        }
        return response.fail(`unknown command ${command}`);
    };

    const registry = createRegistry(executeCommand, [
        { name: 'emit', description: 'Emit literal' },
        { name: 'combine', description: 'Multiply values logically using *' },
    ]);

    const englishScript = [
        '#!english',
        'Compute a value and multiply it by two using available commands.',
    ].join('\n');

    const interpreter = new LightSOPLangInterpreter(englishScript, registry, {
        llmAgent,
        maxLlmaRounds: 3,
        executionMonitor: monitor,
    });

    await interpreter.ready;
    await interpreter.ready;

    assert.equal(interpreter.getVarValue('result'), '5*2');

    const stats = monitor.getStats();
    assert.equal(stats.promptsConsidered, 2);
    const [initialPrompt, retryPrompt] = stats.promptHistory;
    const commandNames = initialPrompt.request.commands.map(entry => entry.name).sort();
    assert.deepEqual(commandNames, ['combine', 'emit']);
    assert.equal(retryPrompt.request.failures[0].reason, 'fail:unknown command multiply');
});

test('LLMAgent can refine scripts across multiple failure rounds', async () => {
    const llmAgent = new MockLLMAgent((prompt) => {
        if (prompt.includes('Generate an initial script')) {
            return [
                '@seed emit alpha',
                '@result failer $seed',
            ].join('\n');
        }
        if (prompt.includes('Attempt 1')) {
            return [
                '@seed emit alpha',
                '@result canceler $seed',
            ].join('\n');
        }
        if (prompt.includes('Attempt 2')) {
            return [
                '@seed emit alpha',
                '@result successor $seed',
            ].join('\n');
        }
        throw new Error('Unexpected prompt content');
    });
    const monitor = new DefaultExecutionMonitor();

    const executeCommand = async (input, response) => {
        const [command, ...parts] = input.split(' ');
        if (command === 'emit') {
            return response.success(parts[0] ?? '');
        }
        if (command === 'failer') {
            return response.fail('planned failure');
        }
        if (command === 'canceler') {
            return response.cancel('planned cancel');
        }
        if (command === 'successor') {
            return response.success(`${parts.join('#')}#done`);
        }
        throw new Error(`Unknown command ${command}`);
    };

    const registry = createRegistry(executeCommand, [
        { name: 'emit', description: 'Emit literal' },
        { name: 'failer', description: 'Always fails' },
        { name: 'canceler', description: 'Always cancels' },
        { name: 'successor', description: 'Succeeds with join' },
    ]);

    const englishScript = [
        '#!english',
        'Start from alpha, and after refining failures, produce a success result.',
    ].join('\n');

    const interpreter = new LightSOPLangInterpreter(englishScript, registry, {
        llmAgent,
        maxLlmaRounds: 5,
        executionMonitor: monitor,
    });

    await interpreter.ready;
    await interpreter.ready;
    await interpreter.ready;

    assert.equal(interpreter.getVarValue('result'), 'alpha#done');

    const stats = monitor.getStats();
    assert.equal(stats.promptsConsidered, 3);
    const [, failPrompt, cancelPrompt] = stats.promptHistory;
    assert.equal(failPrompt.request.failures[0].reason, 'fail:planned failure');
    assert.equal(
        cancelPrompt.request.failures[0].reason,
        'canceled:command canceler canceled (planned cancel)',
    );
    assert.match(stats.promptHistory[0].prompt, /Start from alpha/);
});
