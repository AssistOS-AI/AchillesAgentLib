import assert from 'node:assert/strict';
import test from 'node:test';

import { LoopAgentSession } from '../../LLMAgents/LoopAgenticSession/LoopAgentSession.mjs';
import { buildSupervisorCacheKey } from '../../LLMAgents/LoopAgenticSession/runtime.mjs';

function decision(tool, prompt, reason = 'test') {
    return [
        '## tool',
        tool,
        '',
        '## prompt',
        prompt,
        '',
        '## reason',
        reason,
    ].join('\n');
}

test('alwaysApprove cache is scoped to exact tool name and params', async () => {
    const plannerDecisions = [
        decision('echo', 'alpha'),
        decision('echo', 'alpha'),
        decision('echo', 'beta'),
        decision('final_answer', 'done'),
    ];
    const approvals = [];
    const executions = [];
    const approvalProof = { token: 'proof-alpha' };
    const agent = {
        name: 'SupervisorCacheTestAgent',
        __toolState: new Map(),
        complete: async () => plannerDecisions.shift(),
        interpretMessage: async () => ({ intent: 'accept', confidence: 1 }),
    };
    const session = new LoopAgentSession({
        agent,
        tools: {
            echo: {
                description: 'Echo a value.',
                handler: async (_agent, prompt, options) => {
                    executions.push({ prompt, approval: options.supervisorApproval });
                    return prompt;
                },
            },
        },
        options: {
            supervisor: {
                approve: async (toolChoice) => {
                    approvals.push(toolChoice);
                    if (toolChoice.params === 'alpha') {
                        return { decision: 'alwaysApprove', approval: approvalProof };
                    }
                    return 'approve';
                },
                getOutputWriter: () => ({ write: async () => {} }),
            },
        },
    });

    const result = await session.newPrompt('run');

    assert.equal(result, 'done');
    const echoApprovals = approvals.filter((entry) => entry.toolName === 'echo');
    assert.equal(echoApprovals.length, 2);
    assert.deepEqual(echoApprovals.map((entry) => entry.params), ['alpha', 'beta']);
    assert.equal(executions.length, 3);
    assert.deepEqual(executions[0].approval, approvalProof);
    assert.deepEqual(executions[1].approval, approvalProof);
    assert.equal(executions[2].approval, null);
});

test('supervisor cache key is deterministic for object params', () => {
    assert.equal(
        buildSupervisorCacheKey('bash', { command: 'echo', args: ['ok'] }),
        buildSupervisorCacheKey('bash', { args: ['ok'], command: 'echo' }),
    );
    assert.notEqual(
        buildSupervisorCacheKey('bash', { command: 'echo', args: ['ok'] }),
        buildSupervisorCacheKey('bash', { command: 'echo', args: ['changed'] }),
    );
});

test('structured supervisor denial reason is returned to the planner', async () => {
    const agent = {
        name: 'SupervisorDenialTestAgent',
        __toolState: new Map(),
        complete: async () => decision('echo', 'blocked'),
        interpretMessage: async () => ({ intent: 'accept', confidence: 1 }),
    };
    let executed = false;
    const session = new LoopAgentSession({
        agent,
        tools: {
            echo: {
                description: 'Echo a value.',
                handler: async () => {
                    executed = true;
                },
            },
        },
        options: {
            maxStepsPerTurn: 1,
            supervisor: {
                approve: async () => ({
                    decision: 'deny',
                    status: 'pending',
                    reason: 'Bash execution is waiting for user approval.',
                }),
                getOutputWriter: () => ({ write: async () => {} }),
            },
        },
    });

    const result = await session.newPrompt('run');
    assert.equal(executed, false);
    assert.match(result, /waiting for user approval/i);
});
