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

    await session.newPrompt('first');
    await session.newPrompt('second', { model: 'deep' });

    assert.deepEqual(calls.map((call) => call.model), ['plan', 'deep']);
    assert.equal(session.options.model, 'deep');
});

test('SOPAgenticSession uses a changed model for planning the next turn', async () => {
    const calls = [];
    const agent = {
        name: 'StubLLMAgent',
        __toolState: new Map(),
        executePrompt: async (_prompt, options = {}) => {
            calls.push(options);
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
    assert.equal(session.options.model, 'deep');
});
