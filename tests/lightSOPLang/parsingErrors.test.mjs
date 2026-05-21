import test from 'node:test';
import assert from 'node:assert/strict';

import LightSOPLangInterpreter from '../../lightSOPLang/index.mjs';
import { parseCode } from '../../lightSOPLang/parser.mjs';

test('LightSOPLang parser rejects duplicate variable declarations', async () => {
    const code = [
        '@value emit 1',
        '@value emit 2',
    ].join('\n');

    const interpreter = new LightSOPLangInterpreter(code, {
        executeCommand: async () => null,
        listCommands: () => [],
    });

    await assert.rejects(interpreter.ready, /declared multiple times/);
});

test('Comment parser keeps hashes inside quotes untouched', async () => {
    const interpreter = new LightSOPLangInterpreter([
        '@x emit "value#hash" # comment',
        "@y emit '#tag' # more comments",
    ].join('\n'), {
        executeCommand: async ({ args }, response) => {
            return response.success(args[0] ?? '');
        },
        listCommands: () => [{ name: 'emit', description: 'Return literal' }],
    });

    await interpreter.ready;
    assert.equal(interpreter.getVarValue('x'), 'value#hash');
    assert.equal(interpreter.getVarValue('y'), '#tag');
});

test('Comment parser associates contiguous leading and inline comments with declarations', () => {
    const declarations = parseCode([
        '# Load input context',
        '# before calling the skill',
        '@context emit value # inline detail',
        '',
        '# detached comment',
        '',
        '@next emit ok',
    ].join('\n'));

    assert.equal(declarations.get('context').comment, [
        'Load input context',
        'before calling the skill',
        'inline detail',
    ].join('\n'));
    assert.deepEqual(declarations.get('context').commentLines, [
        'Load input context',
        'before calling the skill',
        'inline detail',
    ]);
    assert.equal(declarations.get('next').comment, '');
});

test('Comment parser accepts a leading comment before the first declaration', () => {
    const declarations = parseCode(String.raw`# Writing new cskill descriptor
@writeSkill write-skill "{\"skillName\":\"demo-test\",\"fileName\":\"cskill.md\",\"content\":\"# Demo Test Skill\\nDescription: Demonstrates a skill that outputs hello.\"}"
# Validating the descriptor
@validateSkill validate-skill demo-test
@lastAnswer final_answer "Skill demo-test created successfully."`);

    assert.equal(declarations.get('writeSkill').comment, 'Writing new cskill descriptor');
    assert.equal(declarations.get('validateSkill').comment, 'Validating the descriptor');
    assert.equal(declarations.get('lastAnswer').command, 'final_answer');
});

test('Comment parser accepts invisible leading characters before a comment', () => {
    const declarations = parseCode([
        '\uFEFF# Writing new cskill descriptor',
        '@writeSkill write-skill demo-test',
    ].join('\n'));

    assert.equal(declarations.get('writeSkill').comment, 'Writing new cskill descriptor');
});

test('Comment parser keeps hash-leading multiline text when it is not immediately before a declaration', () => {
    const declarations = parseCode([
        '@prompt emit',
        '# Markdown heading stays literal',
        'body text',
        '# Progress for next command',
        '@next emit done',
    ].join('\n'));

    assert.equal(declarations.get('prompt').arguments[0].value, [
        '# Markdown heading stays literal',
        'body text',
    ].join('\n'));
    assert.equal(declarations.get('next').comment, 'Progress for next command');
});
