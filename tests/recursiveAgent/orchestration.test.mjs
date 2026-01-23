import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { RecursiveSkilledAgent } from '../../RecursiveSkilledAgents/RecursiveSkilledAgent.mjs';
import { createMiniMCPServer } from './helpers/miniMCP.mjs';
import { StubLLMAgent } from '../helpers/stubLLMAgent.mjs';

const FIXTURE_ROOT = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    'recursiveAgentFixtures',
);

const HIDDEN_FIXTURE_ROOT = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    'hiddenFixtures',
);

const DOWNWARD_FIXTURE_ROOT = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    'downwardFixtures',
);

function createAgent({
    startDir = FIXTURE_ROOT,
    onExecutePrompt = null,
} = {}) {
    const llmAgent = new StubLLMAgent({ onExecutePrompt });
    return new RecursiveSkilledAgent({
        llmAgent,
        startDir,
    });
}

test('RecursiveSkilledAgent searches downward until it reaches the repos folder', () => {
    const agent = new RecursiveSkilledAgent({
        startDir: DOWNWARD_FIXTURE_ROOT,
        searchUpwards: false,
    });

    assert.ok(
        agent.getSkillRecord('repo-planner-orchestrator'),
        'expected repo-based skills to be registered when searching downward',
    );
});

test('RecursiveSkilledAgent descends into hidden directories when searching downward', () => {
    const agent = new RecursiveSkilledAgent({
        startDir: HIDDEN_FIXTURE_ROOT,
        searchUpwards: false,
    });

    assert.ok(
        agent.getSkillRecord('hidden-reporter-claude'),
        'expected hidden directories to be scanned for skills',
    );
});

test('RecursiveSkilledAgent orchestrates via oskill when no skill is supplied', async () => {
    const agent = createAgent();

    const response = await agent.executePrompt('Please prepare the daily warehouse report');

    assert.equal(response.subsystem, 'orchestrator');
    assert.equal(response.result.type, 'orchestrator');
    // Orchestrator executed successfully
});

test('MCP skills honour allowed tool lists when planning', async () => {
    const agent = createAgent();

    const mcpSkill = agent.getSkillRecord('inventory-data-retrieval-mcp');
    assert.ok(mcpSkill, 'expected inventory MCP skill to be registered');

    const miniMCP = await createMiniMCPServer({
        tools: [
            {
                name: 'inventoryLookup',
                title: 'Inventory Lookup',
                description: 'Read inventory records',
            },
            {
                name: 'pricingEngine',
                title: 'Pricing Engine',
                description: 'Adjust pricing entries',
            },
        ],
    });

    const { tools } = await miniMCP.client.listTools({});

    const response = await agent.executePrompt('Collect current stock levels for review.', {
        skillName: mcpSkill.name,
        availableTools: tools,
    });

    assert.equal(response.subsystem, 'mcp');
    assert.equal(response.skill, mcpSkill.name);
    assert.ok(response.result.plan.length >= 1);
    const plannedTools = response.result.plan.map((step) => step.tool);
    assert.deepEqual(plannedTools, ['inventoryLookup']);

    await miniMCP.shutdown();
});

test('Orchestrator fallback spawns dynamic MCP execution when permitted', async () => {
    const agent = createAgent();
    agent.llmAgent.startSOPLangAgentSession = async () => ({
        getVariables: () => ({ lastAnswer: null }),
        getLastResult: () => null,
    });

    const fallbackOrchestrator = agent.getSkillRecord('fallback-planner-orchestrator');
    assert.ok(fallbackOrchestrator, 'expected fallback orchestrator skill');

    const fallbackMCP = await createMiniMCPServer({
        tools: [
            {
                name: 'invoiceLookup',
                title: 'Invoice Lookup',
                description: 'Inspect invoice records',
            },
            {
                name: 'pricingEngine',
                title: 'Pricing Engine',
                description: 'Adjust pricing entries',
            },
        ],
    });

    const fallbackTools = (await fallbackMCP.client.listTools({})).tools;

    const response = await agent.executePrompt('Investigate invoice mismatches for vendor ACME.', {
        skillName: fallbackOrchestrator.name,
        availableTools: fallbackTools,
    });

    assert.equal(response.subsystem, 'orchestrator');
    const fallbackExecution = response.result.fallbackExecution;
    assert.ok(fallbackExecution, 'expected fallback execution to be present');
    assert.equal(fallbackExecution.outcome.result?.type, 'mcp');
    const planTools = (fallbackExecution.outcome.result?.plan || []).map((step) => step.tool);
    assert.deepEqual(planTools, ['invoiceLookup']);

    await fallbackMCP.shutdown();
});

test('Orchestrator rejects self invocation suggested by the model', async () => {
    const agent = createAgent();
    const response = await agent.executePrompt('Trigger recursive loop', {
        skillName: 'llm-planner-orchestrator',
    });

    assert.equal(response.subsystem, 'orchestrator');
    assert.ok(response.result.output.includes('Too many planner errors'));
});
