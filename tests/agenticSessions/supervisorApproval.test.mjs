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

test('supervisor denial skips the handler and becomes planner context', async () => {
    const plannerDecisions = [
        decision('bash', 'ls -la'),
        decision('final_answer', 'The command was not executed because the user denied it.'),
    ];
    const plannerPrompts = [];
    const agent = {
        name: 'SupervisorDenialTestAgent',
        __toolState: new Map(),
        complete: async ({ history }) => {
            plannerPrompts.push(history[0].message);
            return plannerDecisions.shift();
        },
        interpretMessage: async () => ({ intent: 'accept', confidence: 1 }),
    };
    let executed = false;
    let approvalCount = 0;
    const session = new LoopAgentSession({
        agent,
        tools: {
            bash: {
                description: 'Execute a command.',
                handler: async () => {
                    executed = true;
                },
            },
        },
        options: {
            maxStepsPerTurn: 2,
            supervisor: {
                approve: async (toolChoice) => {
                    if (toolChoice.toolName === 'final_answer') {
                        return 'approve';
                    }
                    approvalCount += 1;
                    return {
                        decision: 'deny',
                        status: 'denied',
                        reason: 'The user denied this Bash command. It was not executed.',
                    };
                },
                getOutputWriter: () => ({ write: async () => {} }),
            },
        },
    });

    const result = await session.newPrompt('run');
    assert.equal(executed, false);
    assert.equal(approvalCount, 1);
    assert.equal(result, 'The command was not executed because the user denied it.');
    assert.match(plannerPrompts[1], /Tool "bash" was denied before execution\./);
    assert.match(plannerPrompts[1], /Params: "ls -la"/);
    assert.match(plannerPrompts[1], /Reason: The user denied this Bash command\. It was not executed\./);
    assert.match(plannerPrompts[1], /The tool handler was not called\./);
    assert.doesNotMatch(plannerPrompts[1], /supervisorDecision|"success"\s*:\s*false/);
    assert.equal(session.toolCalls[0].tool, 'bash');
    assert.equal(
        session.toolVars.get(session.toolCalls[0].resultRef),
        [
            'Tool "bash" was denied before execution.',
            'Params: "ls -la"',
            'Reason: The user denied this Bash command. It was not executed.',
            'The tool handler was not called.',
        ].join('\n'),
    );
});
