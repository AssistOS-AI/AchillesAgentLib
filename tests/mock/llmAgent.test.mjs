import test from 'node:test';
import assert from 'node:assert/strict';

import { LLMAgent, LLMAgentRegistry } from '../../LLMAgents/index.mjs';

test('LLMAgent delegates completions to the invokerStrategy', async () => {
    const calls = [];
    const agent = new LLMAgent({
        name: 'MockAgent',
        invokerStrategy: async ({ prompt, tier, agent }) => {
            calls.push({ prompt, tier, agentName: agent.name });
            return `response:${tier}`;
        },
    });

    const fast = await agent.complete({ prompt: 'Hello world', tier: 'fast' });
    assert.equal(fast, 'response:fast');

    const deep = await agent.complete({ prompt: 'Deep dive', tier: 'deep' });
    assert.equal(deep, 'response:deep');

    assert.equal(calls.length, 2);
    assert.deepEqual(calls.map(call => call.tier), ['fast', 'deep']);
    assert.deepEqual(calls.map(call => call.agentName), ['MockAgent', 'MockAgent']);
});

test('LLMAgent interpretMessage classifies user input', async () => {
    const agent = new LLMAgent({
        name: 'ParserAgent',
        invokerStrategy: async ({ prompt }) => {
            if (prompt.includes('Interpret')) {
                return '- intent: update\n- updates: priority=urgent';
            }
            return '- priority: medium';
        },
    });

    const interpreted = await agent.interpretMessage('maybe set priority to urgent', { intents: ['accept', 'cancel', 'update'] });
    assert.equal(interpreted.intent, 'update');
    assert.equal(interpreted.updates.priority, 'urgent');
});

test('LLMAgentRegistry manages agents and defaults', async () => {
    const registry = new LLMAgentRegistry();
    const baseInvoker = async () => 'result';

    const agentA = registry.register({
        name: 'AgentA',
        invokerStrategy: baseInvoker,
    }, { setAsDefault: true });

    const agentB = registry.register({
        name: 'AgentB',
        invokerStrategy: async () => 'B',
    });

    assert.equal(registry.getDefault(), agentA);
    assert.equal(registry.get('AgentB'), agentB);

    registry.registerDefault({
        name: 'AgentC',
        invokerStrategy: async () => 'C',
    });
    assert.equal(registry.getDefault().name, 'AgentC');

    registry.clear();
    assert.equal(registry.list().length, 0);
});

test('LLMAgent tracks character traffic per instance', async () => {
    const agent = new LLMAgent({
        name: 'CounterAgent',
        invokerStrategy: async () => 'ok',
    });

    const history = [{ role: 'system', message: 'init run' }];
    await agent.complete({ prompt: 'Hello', history });

    assert.equal(agent.getInputCounter(), 23);
    assert.equal(agent.getOutputCounter(), 2);

    await agent.complete({ prompt: 'Next one' });

    assert.equal(agent.getInputCounter(), 31);
    assert.equal(agent.getOutputCounter(), 4);
});
