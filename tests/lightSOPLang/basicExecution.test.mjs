import test from 'node:test';
import assert from 'node:assert/strict';

import LightSOPLangInterpreter from '../../lightSOPLang/index.mjs';
import { createRegistry } from './helpers.mjs';

test('LightSOPLang basic execution and dependency resolution', async (t) => {
    const history = [];

    const executeCommand = async ({ command, args }, response) => {
        history.push([command, ...args].join(' '));
        if (command === 'emit') {
            const value = args[0] ?? '';
            return response.success(value);
        }
        if (command === 'combine') {
            const value = args.join('+');
            return response.success(value);
        }
        throw new Error(`Unknown command ${command}`);
    };

    const code = [
        '@source emit foo',
        '@middle combine $source bar',
        '@final combine $source $middle',
    ].join('\n');

    const registry = createRegistry(executeCommand, [
        { name: 'emit', description: 'Outputs provided literal' },
        { name: 'combine', description: 'Concatenates parameters with +' },
    ]);

    const interpreter = new LightSOPLangInterpreter(code, registry);
    await interpreter.ready;

    await t.test('final value aggregates dependency outputs', () => {
        assert.equal(interpreter.getVarValue('source'), 'foo');
        assert.equal(interpreter.getVarValue('middle'), 'foo+bar');
        assert.equal(interpreter.getVarValue('final'), 'foo+foo+bar');
    });

    await t.test('commands executed once in topological order', () => {
        assert.deepEqual(history, [
            'emit foo',
            'combine foo bar',
            'combine foo foo+bar',
        ]);
    });
});

test('LightSOPLang treats lines until the next @ declaration as a clean multiline argument', async () => {
    const payloads = [];
    const registry = createRegistry(async (payload, response) => {
        payloads.push(payload);
        if (payload.command === 'emit') {
            return response.success(payload.args[0] ?? '');
        }
        if (payload.command === 'combine') {
            return response.success(payload.args.join('\n---\n'));
        }
        throw new Error(`Unknown command ${payload.command}`);
    }, [
        { name: 'emit', description: 'Outputs provided literal' },
        { name: 'combine', description: 'Combines parameters' },
    ]);

    const code = [
        '@prompt emit',
        'Write a short answer.',
        '# Keep markdown headings as text, not comments.',
        'Use clean multiline text.',
        '@combined combine $prompt',
        'Append this instruction without escaping newlines.',
    ].join('\n');

    const interpreter = new LightSOPLangInterpreter(code, registry);
    await interpreter.ready;

    assert.deepEqual(payloads[0].args, [
        [
            'Write a short answer.',
            '# Keep markdown headings as text, not comments.',
            'Use clean multiline text.',
        ].join('\n'),
    ]);
    assert.deepEqual(payloads[1].args, [
        [
            'Write a short answer.',
            '# Keep markdown headings as text, not comments.',
            'Use clean multiline text.',
        ].join('\n'),
        'Append this instruction without escaping newlines.',
    ]);
    assert.equal(interpreter.getVarValue('combined'), [
        'Write a short answer.',
        '# Keep markdown headings as text, not comments.',
        'Use clean multiline text.',
        '---',
        'Append this instruction without escaping newlines.',
    ].join('\n'));
});
