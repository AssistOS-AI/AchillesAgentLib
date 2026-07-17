import assert from 'node:assert/strict';
import { test } from 'node:test';

import { LoopAgentSession } from '../../LLMAgents/LoopAgenticSession/LoopAgentSession.mjs';
import { SOPAgenticSession } from '../../LLMAgents/SOPAgenticSession/SOPAgenticSession.mjs';
import {
    SESSION_STATUS_ACTIVE,
    SESSION_STATUS_INTERRUPTED,
} from '../../LLMAgents/constants.mjs';

function createAbortError(message = 'aborted') {
    const error = new Error(message);
    error.name = 'AbortError';
    return error;
}

test('LoopAgentSession marks interrupted and resumes on next prompt', async () => {
    let plannerCalls = 0;
    const agent = {
        name: 'StubLLMAgent',
        __toolState: new Map(),
        complete: async (options = {}) => {
            plannerCalls += 1;
            if (plannerCalls === 1) {
                return new Promise((resolve, reject) => {
                    const signal = options?.signal;
                    if (signal?.aborted) {
                        reject(createAbortError('aborted-before-start'));
                        return;
                    }
                    signal?.addEventListener('abort', () => reject(createAbortError('aborted-during-planner')), { once: true });
                });
            }
            return [
                '## tool',
                'final_answer',
                '',
                '## prompt',
                'resumed',
                '',
                '## reason',
                'resume-flow',
            ].join('\n');
        },
        interpretMessage: async () => ({ intent: 'accept', confidence: 1 }),
    };

    const session = new LoopAgentSession({
        agent,
        tools: {
            echo: {
                description: 'Echo tool',
                handler: async (_agent, payload) => payload,
            },
        },
    });

    const firstController = new AbortController();
    const interruptedRun = session.newPrompt('run and interrupt', { signal: firstController.signal });
    setTimeout(() => firstController.abort('esc'), 10);
    const interruptedResult = await interruptedRun;

    assert.equal(session.status, SESSION_STATUS_INTERRUPTED);
    assert.equal(interruptedResult, 'Interrupted by user');
    assert.ok(session.history.some((entry) => entry?.type === 'system' && entry?.event === SESSION_STATUS_INTERRUPTED));

    const resumedResult = await session.newPrompt('resume after cancel');
    assert.equal(resumedResult, 'resumed');
    assert.equal(session.status, SESSION_STATUS_ACTIVE);
});

test('SOPAgenticSession marks interrupted and resumes on next prompt', async () => {
    let executePromptCalls = 0;
    const agent = {
        name: 'StubLLMAgent',
        __toolState: new Map(),
        complete: async () => ({ intent: 'accept', confidence: 1 }),
        interpretMessage: async () => ({ intent: 'accept', confidence: 1 }),
        executePrompt: async (_prompt, options = {}) => {
            executePromptCalls += 1;
            if (executePromptCalls === 1) {
                return new Promise((_resolve, reject) => {
                    const signal = options?.signal;
                    if (signal?.aborted) {
                        reject(createAbortError('aborted-before-plan'));
                        return;
                    }
                    signal?.addEventListener('abort', () => reject(createAbortError('aborted-during-plan')), { once: true });
                });
            }
            return '@lastAnswer final_answer "resumed"';
        },
    };

    const session = new SOPAgenticSession({
        agent,
        skillsDescription: {
            echo: 'Echo utility',
        },
        options: {
            commandsRegistry: {
                executeCommand: async (payload, responder) => {
                    if (payload.command === 'echo') {
                        return responder.success((payload.args || []).join(' '));
                    }
                    return responder.success('ok');
                },
                listCommands: () => [{ name: 'echo', description: 'Echo utility' }],
            },
        },
    });

    const firstController = new AbortController();
    const interruptedRun = session.newPrompt('build plan', { signal: firstController.signal });
    setTimeout(() => firstController.abort('esc'), 10);
    const interruptedResult = await interruptedRun;

    assert.equal(session.status, SESSION_STATUS_INTERRUPTED);
    assert.equal(interruptedResult.answer, 'Interrupted by user');
    assert.ok(session.history.some((entry) => entry?.type === 'system' && entry?.event === SESSION_STATUS_INTERRUPTED));

    const resumedResult = await session.newPrompt('resume plan');
    assert.equal(resumedResult.answer, 'resumed');
    assert.equal(session.status, SESSION_STATUS_ACTIVE);
});

test('SOPAgenticSession emits associated SOP comments as tool_reason progress', async () => {
    const progressEvents = [];
    const executed = [];
    const agent = {
        name: 'StubLLMAgent',
        __toolState: new Map(),
        executePrompt: async () => [
            '# Fetch the requested information',
            '# using the echo skill',
            '@first echo hello',
            '# Prepare local text only',
            '@local assign',
            'not shown as progress',
            '# Final response is not a progress event',
            '@lastAnswer final_answer $first',
        ].join('\n'),
    };

    const session = new SOPAgenticSession({
        agent,
        skillsDescription: {
            echo: 'Echo utility',
        },
        options: {
            supervisor: {
                getOutputWriter: () => ({
                    write: async (message) => {
                        progressEvents.push(message);
                    },
                }),
            },
            commandsRegistry: {
                executeCommand: async (payload, responder) => {
                    executed.push(payload);
                    return responder.success((payload.args || []).join(' '));
                },
                listCommands: () => [{ name: 'echo', description: 'Echo utility' }],
            },
        },
    });

    const result = await session.newPrompt('run plan');

    assert.equal(result.answer, 'hello');
    assert.deepEqual(progressEvents, [{
        type: 'tool_reason',
        tool: 'echo',
        reason: 'Fetch the requested information\nusing the echo skill',
        stepIndex: 3,
    }]);
    assert.equal(executed.length, 1);
    assert.equal(executed[0].comment, 'Fetch the requested information\nusing the echo skill');
});

test('SOPAgenticSession rejects commands that are not in the current registry and retries', async () => {
    let promptText = '';
    let plannerCalls = 0;
    const executed = [];
    const agent = {
        name: 'StubLLMAgent',
        __toolState: new Map(),
        executePrompt: async (prompt, options = {}) => {
            plannerCalls += 1;
            promptText = [
                ...(options.history || []).map((entry) => entry.message),
                prompt,
            ].join('\n');
            if (plannerCalls === 1) {
                return [
                    '@wrong skills-orchestrator "Create a new orchestration skill named demo-skill."',
                    '@lastAnswer final_answer "demo-skill created successfully."',
                ].join('\n');
            }
            return [
                '@created echo "Create a new orchestration skill named demo-skill."',
                '@lastAnswer final_answer $created',
            ].join('\n');
        },
    };

    const session = new SOPAgenticSession({
        agent,
        skillsDescription: {
            echo: 'Echo utility',
        },
        options: {
            commandsRegistry: {
                executeCommand: async (payload, responder) => {
                    executed.push(payload);
                    return responder.success((payload.args || []).join(' '));
                },
                listCommands: () => [{ name: 'echo', description: 'Echo utility' }],
            },
            maxPlanAttempts: 2,
        },
    });

    const result = await session.newPrompt('create demo-skill');

    assert.equal(result.answer, 'Create a new orchestration skill named demo-skill.');
    assert.equal(plannerCalls, 2);
    assert.equal(executed.length, 1);
    assert.equal(executed[0].command, 'echo');
    assert.ok(!promptText.includes('Allowed commands for this plan:'));
    assert.ok(promptText.includes('The Commands section is the only executable tool surface.'));
    assert.ok(promptText.includes('Commands:'));
    assert.ok(promptText.includes('- echo: Echo utility'));
    assert.ok(session.lastRunFailures.length === 0);
});
