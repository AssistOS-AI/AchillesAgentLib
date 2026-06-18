import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    isOptOutModel,
    mapMessagesToLoopInput,
    runOpenAiAgenticResponse,
} from './openAiAgenticResponder.mjs';

test('isOptOutModel matches none/off case-insensitively', () => {
    assert.equal(isOptOutModel('none'), true);
    assert.equal(isOptOutModel('OFF'), true);
    assert.equal(isOptOutModel('plan'), false);
    assert.equal(isOptOutModel(undefined), false);
});

test('mapMessagesToLoopInput splits system, transcript, last user', () => {
    const out = mapMessagesToLoopInput([
        { role: 'system', content: 'You are X.' },
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello' },
        { role: 'user', content: 'now do Y' },
    ]);
    assert.equal(out.systemPrompt, 'You are X.');
    assert.equal(out.initialPrompt, 'now do Y');
    assert.match(out.transcript, /hi/);
    assert.match(out.transcript, /hello/);
});

test('runOpenAiAgenticResponse returns an OpenAI chat.completion from the loop result', async () => {
    const fakeSession = { getLastResult: () => 'the answer', status: 'completed' };
    const fakeAgent = {
        startLoopAgentSession: async (tools, prompt, opts) => {
            assert.equal(typeof prompt, 'string');
            assert.equal(opts.model, 'plan');
            return fakeSession;
        },
    };
    const res = await runOpenAiAgenticResponse({
        toolsMap: {},
        messages: [{ role: 'user', content: 'q' }],
        model: 'plan',
        agentId: 'agent:llm-runtime/base-local',
        agentFactory: () => fakeAgent,
    });
    assert.equal(res.object, 'chat.completion');
    assert.equal(res.model, 'plan');
    assert.equal(res.choices[0].message.role, 'assistant');
    assert.equal(res.choices[0].message.content, 'the answer');
    assert.equal(res.choices[0].finish_reason, 'stop');
    assert.ok(res.usage);
});

test('runOpenAiAgenticResponse throws on empty user message', async () => {
    await assert.rejects(
        () => runOpenAiAgenticResponse({
            toolsMap: {},
            messages: [{ role: 'system', content: 'x' }],
            model: 'plan',
            agentFactory: () => ({ startLoopAgentSession: async () => ({ getLastResult: () => '', status: 'completed' }) }),
        }),
        /no user message/i,
    );
});

test('runOpenAiAgenticResponse forwards a timeout abort signal to the loop session', async () => {
    const fakeSession = { getLastResult: () => 'ok', status: 'completed' };
    const fakeAgent = {
        startLoopAgentSession: async (tools, prompt, opts) => {
            assert.equal(typeof opts.signal?.addEventListener, 'function');
            assert.equal(opts.signal.aborted, false);
            return fakeSession;
        },
    };
    await runOpenAiAgenticResponse({
        toolsMap: {},
        messages: [{ role: 'user', content: 'q' }],
        model: 'plan',
        agentFactory: () => fakeAgent,
    });
});
