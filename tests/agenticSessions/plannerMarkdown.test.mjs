import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parsePlannerDecisionMarkdown } from '../../LLMAgents/LoopAgenticSession/plannerMarkdown.mjs';

test('parsePlannerDecisionMarkdown parses standard planner markdown', () => {
    const parsed = parsePlannerDecisionMarkdown([
        '## tool',
        'echo',
        '',
        '## prompt',
        'Say hello',
        '',
        '## reason',
        'Need the echo tool.',
    ].join('\n'));

    assert.deepEqual(parsed, {
        tool: 'echo',
        prompt: 'Say hello',
        reason: 'Need the echo tool.',
    });
});

test('parsePlannerDecisionMarkdown tolerates heading case and aliases', () => {
    const parsed = parsePlannerDecisionMarkdown([
        '# TOOL',
        'final_answer',
        '',
        '### Prompt',
        'Done',
        '',
        '#### Reason',
        'Finished.',
    ].join('\n'));

    assert.deepEqual(parsed, {
        tool: 'final_answer',
        prompt: 'Done',
        reason: 'Finished.',
    });
});

test('parsePlannerDecisionMarkdown preserves multiline prompt content', () => {
    const parsed = parsePlannerDecisionMarkdown([
        '## tool',
        'shell',
        '',
        '## prompt',
        'Run this command:',
        '```json',
        '{"not":"a planner object"}',
        '```',
        '',
        '## reason',
        'Inspect files.',
    ].join('\n'));

    assert.deepEqual(parsed, {
        tool: 'shell',
        prompt: [
            'Run this command:',
            '```json',
            '{"not":"a planner object"}',
            '```',
        ].join('\n'),
        reason: 'Inspect files.',
    });
});

test('parsePlannerDecisionMarkdown allows missing reason', () => {
    const parsed = parsePlannerDecisionMarkdown([
        '## tool',
        'final_answer',
        '',
        '## prompt',
        'Done',
    ].join('\n'));

    assert.deepEqual(parsed, {
        tool: 'final_answer',
        prompt: 'Done',
        reason: '',
    });
});

test('parsePlannerDecisionMarkdown rejects missing required sections and legacy JSON', () => {
    assert.equal(parsePlannerDecisionMarkdown('{"tool":"echo","prompt":"hello","reason":"legacy"}'), null);
    assert.equal(parsePlannerDecisionMarkdown('## tool\necho\n\n## reason\nmissing prompt'), null);
    assert.equal(parsePlannerDecisionMarkdown('## prompt\nhello\n\n## reason\nmissing tool'), null);
    assert.equal(parsePlannerDecisionMarkdown('## tool\necho\n\n## instruction\nwrong key\n\n## reason\nwrong key'), null);
    assert.equal(parsePlannerDecisionMarkdown({ tool: 'echo', prompt: 'hello' }), null);
});
