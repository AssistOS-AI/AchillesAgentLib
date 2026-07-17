import assert from 'node:assert/strict';
import { test } from 'node:test';

import { LLMAgent } from '../../LLMAgents/LLMAgent.mjs';
import { LoopAgentSession } from '../../LLMAgents/LoopAgenticSession/LoopAgentSession.mjs';
import { SOPAgenticSession } from '../../LLMAgents/SOPAgenticSession/SOPAgenticSession.mjs';
import { callLLMWithModel } from '../../utils/LLMClient.mjs';
import { createOpenAIChatMockServer } from '../helpers/openAIChatMockServer.mjs';

function plannerDecision(tool, prompt) {
    return [
        '## tool',
        tool,
        '',
        '## prompt',
        prompt,
        '',
        '## reason',
        'HTTP history contract test.',
    ].join('\n');
}

function createHttpLLMAgent(baseURL, name) {
    return new LLMAgent({
        name,
        invokerStrategy: async (invocation = {}) => {
            const output = await callLLMWithModel(
                'openai/mock-model',
                invocation.history,
                invocation.prompt,
                {
                    providerKey: 'openai',
                    baseURL,
                    apiKey: 'mock-api-key',
                    signal: invocation.signal,
                },
            );
            return {
                output,
                model: 'openai/mock-model',
                requestedTags: invocation.tags || [],
                matchedTags: [],
            };
        },
    });
}

function roles(request) {
    return request.body.messages.map((message) => message.role);
}

test('Loop sends role-separated multi-turn history through the OpenAI HTTP provider', async () => {
    const mock = await createOpenAIChatMockServer([
        plannerDecision('echo', 'tool payload'),
        plannerDecision('final_answer', 'loop answer one'),
        plannerDecision('final_answer', 'loop answer two'),
    ]);

    try {
        const agent = createHttpLLMAgent(mock.baseURL, 'LoopHttpHistoryTest');
        const session = new LoopAgentSession({
            agent,
            tools: {
                echo: {
                    description: 'Return the supplied payload.',
                    handler: async (_agent, payload) => payload,
                },
            },
            options: {
                model: 'openai/mock-model',
                tags: ['testing'],
                historyCompressionEnabled: false,
            },
        });

        await session.newPrompt('LOOP_FIRST_USER_PROMPT');
        await session.newPrompt('LOOP_SECOND_USER_PROMPT');

        assert.equal(mock.requests.length, 3);
        for (const request of mock.requests) {
            assert.equal(request.method, 'POST');
            assert.equal(request.url, '/v1/chat/completions');
            assert.equal(request.headers.authorization, 'Bearer mock-api-key');
            assert.equal(request.body.model, 'mock-model');
        }

        assert.deepEqual(roles(mock.requests[0]), ['system', 'user']);
        assert.deepEqual(roles(mock.requests[1]), ['system', 'user']);
        assert.deepEqual(roles(mock.requests[2]), [
            'system',
            'user',
            'assistant',
            'user',
        ]);

        assert.equal(mock.requests[0].body.messages[1].content, 'LOOP_FIRST_USER_PROMPT');
        assert.equal(mock.requests[1].body.messages[1].content, 'LOOP_FIRST_USER_PROMPT');
        assert.match(mock.requests[1].body.messages[0].content, /tool payload/);
        assert.equal(
            mock.requests[1].body.messages.some((message) => (
                message.role === 'assistant' && message.content.includes('tool payload')
            )),
            false,
        );
        assert.deepEqual(
            mock.requests[2].body.messages.slice(1),
            [
                { role: 'user', content: 'LOOP_FIRST_USER_PROMPT' },
                { role: 'assistant', content: 'loop answer one' },
                { role: 'user', content: 'LOOP_SECOND_USER_PROMPT' },
            ],
        );
        assert.equal(
            mock.requests[2].body.messages[0].content.includes('LOOP_SECOND_USER_PROMPT'),
            false,
        );
    } finally {
        await mock.close();
    }
});

test('SOP sends role-separated multi-turn history through the OpenAI HTTP provider', async () => {
    const firstPlan = '@lastAnswer final_answer "sop answer one"';
    const secondPlan = '@lastAnswer final_answer "sop answer two"';
    const mock = await createOpenAIChatMockServer([firstPlan, secondPlan]);

    try {
        const agent = createHttpLLMAgent(mock.baseURL, 'SopHttpHistoryTest');
        const session = new SOPAgenticSession({
            agent,
            skillsDescription: {},
            options: {
                model: 'openai/mock-model',
                tags: ['testing'],
                commandsRegistry: {
                    executeCommand: async (_payload, responder) => responder.success('ok'),
                    listCommands: () => [],
                },
            },
        });

        await session.newPrompt('SOP_FIRST_USER_PROMPT');
        await session.newPrompt('SOP_SECOND_USER_PROMPT');

        assert.equal(mock.requests.length, 2);
        for (const request of mock.requests) {
            assert.equal(request.method, 'POST');
            assert.equal(request.url, '/v1/chat/completions');
            assert.equal(request.headers.authorization, 'Bearer mock-api-key');
            assert.equal(request.body.model, 'mock-model');
        }

        assert.deepEqual(roles(mock.requests[0]), ['system', 'user']);
        assert.deepEqual(roles(mock.requests[1]), [
            'system',
            'user',
            'assistant',
            'user',
        ]);
        const firstUserMessage = mock.requests[0].body.messages[1].content;
        const secondUserMessage = mock.requests[1].body.messages[3].content;
        assert.match(firstUserMessage, /SOP_FIRST_USER_PROMPT/);
        assert.match(secondUserMessage, /SOP_SECOND_USER_PROMPT/);
        assert.deepEqual(
            mock.requests[1].body.messages.slice(1, 3),
            [
                { role: 'user', content: 'SOP_FIRST_USER_PROMPT' },
                { role: 'assistant', content: firstPlan },
            ],
        );
        assert.equal(
            mock.requests[1].body.messages[0].content.includes('SOP_SECOND_USER_PROMPT'),
            false,
        );
    } finally {
        await mock.close();
    }
});
