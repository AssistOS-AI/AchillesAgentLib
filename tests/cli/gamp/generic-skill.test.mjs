import fs from 'node:fs';
import path from 'node:path';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

import genericSkill from '../../../cli/achilles-cli/.AchillesSkills/gamp/generic-skill/generic-skill.js';
import { LLMAgent } from '../../../LLMAgents/LLMAgent.mjs';

const TEMP_ROOT = path.join(process.cwd(), 'tests', '.tmp', 'generic-skill');

// Cleanup temp directories after all tests complete
after(() => {
    if (fs.existsSync(TEMP_ROOT)) {
        fs.rmSync(TEMP_ROOT, { recursive: true, force: true });
    }
});

const makeWorkspace = (label) => {
    fs.mkdirSync(TEMP_ROOT, { recursive: true });
    const dir = path.join(TEMP_ROOT, `${label}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'app.mjs'), 'export const value = 1;\n');
    return dir;
};

const makeLLM = (handlers = {}) => new LLMAgent({
    invokerStrategy: async ({ context }) => {
        if (context?.intent && handlers[context.intent]) {
            return handlers[context.intent];
        }
        return '[]';
    },
});

test('generic skill can list and read files based on the LLM plan', { concurrency: false, timeout: 10_000 }, async () => {
    const workspace = makeWorkspace('list-read');
    const llm = makeLLM({
        'generic-skill-plan': JSON.stringify([
            { tool: 'list-files', target: 'src' },
            { tool: 'read-file', target: 'src/app.mjs' },
        ]),
    });

    const result = await genericSkill({
        prompt: 'Inspect the src folder and show app.mjs.',
        context: { workspaceRoot: workspace, llmAgent: llm },
    });

    assert.equal(result.steps.length, 2);
    assert.equal(result.steps[0].status, 'ok');
    assert.ok(result.steps[0].result.entries.length >= 1);
    assert.equal(result.steps[1].status, 'ok');
    assert.ok(result.steps[1].result.snippet.includes('value = 1'));
});

test('generic skill rewrites files via LLMAgent', { concurrency: false, timeout: 10_000 }, async () => {
    const workspace = makeWorkspace('rewrite');
    const llm = makeLLM({
        'generic-skill-plan': JSON.stringify([
            { tool: 'rewrite-file', target: 'src/app.mjs', instructions: 'Return 42.' },
        ]),
        'generic-skill-rewrite': '```js\nexport const value = 42;\n```',
    });

    const result = await genericSkill({
        prompt: 'Make sure value equals 42.',
        context: { workspaceRoot: workspace, llmAgent: llm },
    });

    assert.equal(result.steps.length, 1);
    assert.equal(result.steps[0].status, 'ok');

    const rewritten = fs.readFileSync(path.join(workspace, 'src', 'app.mjs'), 'utf8');
    assert.ok(rewritten.includes('42'), 'File should be rewritten with the new value.');
});

test('generic skill creates and appends files with new tooling', { concurrency: false, timeout: 10_000 }, async () => {
    const workspace = makeWorkspace('create-append');
    const llm = makeLLM({
        'generic-skill-plan': JSON.stringify([
            { tool: 'create-file', target: 'docs/note.txt', content: 'First line' },
            { tool: 'append-file', target: 'docs/note.txt', content: 'Second line' },
            { tool: 'read-file', target: 'docs/note.txt' },
        ]),
    });

    const result = await genericSkill({
        prompt: 'Prepare release notes.',
        context: { workspaceRoot: workspace, llmAgent: llm },
    });

    assert.equal(result.steps.length, 3);
    assert.equal(result.steps[0].status, 'ok');
    assert.equal(result.steps[1].status, 'ok');
    assert.equal(result.steps[2].status, 'ok');
    const finalContent = fs.readFileSync(path.join(workspace, 'docs', 'note.txt'), 'utf8');
    assert.match(finalContent, /First line/);
    assert.match(finalContent, /Second line/);
});

test('generic skill delete-path removes files safely', { concurrency: false, timeout: 10_000 }, async () => {
    const workspace = makeWorkspace('delete-path');
    const targetFile = path.join(workspace, 'src', 'temp.txt');
    fs.writeFileSync(targetFile, 'temporary');
    const llm = makeLLM({
        'generic-skill-plan': JSON.stringify([
            { tool: 'delete-path', target: 'src/temp.txt' },
        ]),
    });

    const result = await genericSkill({
        prompt: 'Clean temporary files.',
        context: { workspaceRoot: workspace, llmAgent: llm },
    });

    assert.equal(result.steps.length, 1);
    assert.equal(result.steps[0].status, 'ok');
    assert.equal(result.steps[0].result.deleted, true);
    assert.equal(fs.existsSync(targetFile), false);
});
