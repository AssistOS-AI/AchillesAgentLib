import assert from 'node:assert/strict';
import { test } from 'node:test';

import { LoopAgentSession } from '../../LLMAgents/LoopAgenticSession/LoopAgentSession.mjs';
import { SOPAgenticSession } from '../../LLMAgents/SOPAgenticSession/SOPAgenticSession.mjs';

function finalAnswerDecision(answer) {
    return [
        '## tool',
        'final_answer',
        '',
        '## prompt',
        answer,
        '',
        '## reason',
        'The request is complete.',
    ].join('\n');
}

test('LoopAgentSession uses a changed model for every call in the next turn', async () => {
    const calls = [];
    const agent = {
        name: 'StubLLMAgent',
        __toolState: new Map(),
        complete: async (options = {}) => {
            calls.push(options);
            return finalAnswerDecision('done');
        },
    };
    const session = new LoopAgentSession({
        agent,
        tools: {},
        options: {
            model: 'plan',
            historyCompressionEnabled: false,
        },
    });

    await session.newPrompt('UNIQUE_CURRENT_TURN_ALPHA');
    await session.newPrompt('UNIQUE_CURRENT_TURN_BETA', { model: 'deep' });

    assert.deepEqual(calls.map((call) => call.model), ['plan', 'deep']);
    assert.equal(calls[0].prompt, 'UNIQUE_CURRENT_TURN_ALPHA');
    assert.deepEqual(calls[0].history.map((entry) => entry.role), ['system']);
    assert.equal(calls[0].history[0].message.includes('UNIQUE_CURRENT_TURN_ALPHA'), false);
    assert.equal(calls[1].prompt, 'UNIQUE_CURRENT_TURN_BETA');
    assert.deepEqual(
        calls[1].history.slice(1),
        [
            { role: 'user', message: 'UNIQUE_CURRENT_TURN_ALPHA' },
            { role: 'assistant', message: 'done' },
        ],
    );
    assert.equal(calls[1].history[0].role, 'system');
    assert.equal(calls[1].history[0].message.includes('UNIQUE_CURRENT_TURN_BETA'), false);
    assert.deepEqual(
        session.history.filter((entry) => (
            entry.type === 'user' || entry.type === 'final_answer'
        )),
        [
            { type: 'user', prompt: 'UNIQUE_CURRENT_TURN_ALPHA' },
            { type: 'final_answer', answer: 'done' },
            { type: 'user', prompt: 'UNIQUE_CURRENT_TURN_BETA' },
            { type: 'final_answer', answer: 'done' },
        ],
    );
    assert.equal(
        session.history.some((entry) => Object.prototype.hasOwnProperty.call(entry, 'role')),
        false,
    );
    assert.equal(session.options.model, 'deep');
});

test('SOPAgenticSession uses a changed model for planning the next turn', async () => {
    const calls = [];
    const agent = {
        name: 'StubLLMAgent',
        __toolState: new Map(),
        executePrompt: async (prompt, options = {}) => {
            calls.push({ prompt, ...options });
            return '@lastAnswer final_answer "done"';
        },
    };
    const session = new SOPAgenticSession({
        agent,
        skillsDescription: {},
        options: {
            model: 'plan',
            commandsRegistry: {
                executeCommand: async (_payload, responder) => responder.success('ok'),
                listCommands: () => [],
            },
        },
    });

    await session.newPrompt('first');
    await session.newPrompt('second', { model: 'deep' });

    assert.deepEqual(calls.map((call) => call.model), ['plan', 'deep']);
    assert.equal(calls[0].prompt, 'first');
    assert.deepEqual(calls[0].history.map((entry) => entry.role), ['system']);
    assert.equal(calls[0].history[0].message.includes('first'), false);
    assert.equal(calls[1].prompt, 'second');
    assert.deepEqual(
        calls[1].history.slice(1),
        [
            { role: 'user', message: 'first' },
            { role: 'assistant', message: '@lastAnswer final_answer "done"' },
        ],
    );
    assert.equal(calls[1].history[0].role, 'system');
    assert.equal(calls[1].history[0].message.includes('second'), false);
    assert.deepEqual(
        session.history,
        [
            { prompt: 'first', plan: '@lastAnswer final_answer "done"' },
            { prompt: 'second', plan: '@lastAnswer final_answer "done"' },
        ],
    );
    assert.equal(session.options.model, 'deep');
});
