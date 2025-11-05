import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { SkilledAgent } from '../../SkilledAgents/SkilledAgent.mjs';
import { RecursiveSkilledAgent } from '../../RecursiveSkilledAgents/RecursiveSkilledAgent.mjs';
import { OrchestratorSkillsSubsystem } from '../../OrchestratorSkillsSubsystem/OrchestratorSkillsSubsystem.mjs';
import { MCPSkillsSubsystem } from '../../MCPSkillsSubsystem/MCPSkillsSubsystem.mjs';
import { createMiniMCPServer } from './helpers/miniMCP.mjs';

class StubLLMAgent {
    constructor({ onExecutePrompt = null } = {}) {
        this.onExecutePrompt = onExecutePrompt;
    }

    executePrompt(prompt, options = {}) {
        if (typeof this.onExecutePrompt === 'function') {
            const override = this.onExecutePrompt(prompt, options);
            if (override !== undefined) {
                return override;
            }
        }

        const context = options.context || {};
        const intent = context.intent || '';
        const skillName = context.skillName || '';

        if (intent === 'orchestrator-plan') {
            if (skillName === 'planner-orchestrator-orchestrator') {
                return {
                    plan: [
                        { intent: 'reporting', skill: 'logistics-report-claude', run: true, input: prompt, reason: 'Primary reporting path' },
                        { intent: 'data-fetch', skill: 'inventory-data-retrieval-mcp', run: true, input: prompt, reason: 'Retrieve supporting data' },
                    ],
                    notes: '',
                };
            }
            if (skillName === 'fallback-planner-orchestrator') {
                return { plan: [], notes: '' };
            }
            if (skillName === 'llm-planner-orchestrator') {
                return {
                    plan: [
                        { intent: 'summary', skill: 'llm-reporter-claude', run: true, input: prompt, reason: 'Summarise findings' },
                        { intent: 'data-fetch', skill: 'llm-data-lookup-mcp', run: true, input: prompt, reason: 'Gather data for summary' },
                    ],
                    notes: 'Default stub plan',
                };
            }
        }

        if (intent === 'mcp-skill-plan') {
            if (skillName === 'inventory-data-retrieval-mcp') {
                return {
                    plan: [
                        { tool: 'inventoryLookup', arguments: prompt, why: 'Default stub selection' },
                    ],
                    notes: '',
                };
            }
            if (skillName === 'fallback-planner-orchestrator-fallback-mcp') {
                return {
                    plan: [
                        { tool: 'invoiceLookup', arguments: prompt, why: 'Fallback lookup' },
                    ],
                    notes: '',
                };
            }
            if (skillName === 'llm-data-lookup-mcp') {
                return {
                    plan: [
                        { tool: 'metricScanner', arguments: prompt, why: 'Collect metrics for reporting' },
                    ],
                    notes: '',
                };
            }
        }

        throw new Error(`Stub LLMAgent received unhandled request for intent "${intent}" and skill "${skillName}".`);
    }

    complete() {
        return '';
    }
}

const FIXTURE_ROOT = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    'recursiveAgentFixtures',
);

function createAgent({
    startDir = FIXTURE_ROOT,
    onExecutePrompt = null,
} = {}) {
    const llmAgent = new StubLLMAgent({ onExecutePrompt });
    const skilledAgent = new SkilledAgent({ llmAgent });
    return new RecursiveSkilledAgent({
        skilledAgent,
        startDir,
    });
}

test('Orchestrator LightSOPLang scripts receive the prompt as $input', async () => {
    const subsystem = new OrchestratorSkillsSubsystem({ llmAgent: new StubLLMAgent() });
    const capturedInputs = [];

    const allowedSkillRecord = {
        name: 'echo-skill',
        shortName: 'echo',
        descriptor: { summary: 'Echo downstream input' },
    };

    const recursiveAgent = {
        skillCatalog: new Map([[allowedSkillRecord.name, allowedSkillRecord]]),
        executeWithReviewMode: async (input, options) => {
            capturedInputs.push(input);
            return { skill: options.skillName, input };
        },
    };

    const skillRecord = {
        name: 'input-aware-orchestrator',
        metadata: {
            script: [
                '@origin prompt',
                '@run echo $input "Use supplied input" summary',
            ].join('\n'),
            allowedSkills: ['echo-skill'],
            fallback: null,
        },
    };

    const result = await subsystem.executeScriptPlan({
        skillRecord,
        recursiveAgent,
        promptText: 'Primary orchestration prompt',
        options: {},
    });

    assert.equal(capturedInputs.length, 1);
    assert.equal(capturedInputs[0], 'Primary orchestration prompt');
    assert.equal(result.result.plan[0].input, 'Primary orchestration prompt');
});

test('MCP LightSOPLang scripts receive the prompt as $input', async () => {
    const subsystem = new MCPSkillsSubsystem();

    const skillRecord = {
        name: 'input-aware-mcp',
        metadata: {
            script: '@step diagnosticTool $input "Use supplied input"',
            allowedTools: ['diagnostictool'],
        },
    };

    const tools = [
        { name: 'diagnosticTool', description: 'Runs diagnostics based on input' },
    ];

    const response = await subsystem.executeScriptPlan({
        skillRecord,
        promptText: 'Investigate system state',
        tools,
    });

    assert.equal(response.result.plan.length, 1);
    assert.equal(response.result.plan[0].arguments, 'Investigate system state');
});

test('RecursiveSkilledAgent orchestrates via oskill when no skill is supplied', async () => {
    const agent = createAgent();

    const response = await agent.executePrompt('Please prepare the daily warehouse report');

    assert.equal(response.subsystem, 'orchestrator');
    assert.ok(Array.isArray(response.result.plan));
    const executedSkills = response.result.executions
        .filter((execution) => execution.outcome)
        .map((execution) => execution.outcome.skill);
    assert.ok(executedSkills.length > 0, 'orchestrator should execute at least one downstream skill');
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
    const fallbackExecution = response.result.executions.find((execution) => execution && execution.fallback);
    assert.ok(fallbackExecution, 'expected fallback execution to be present');
    assert.equal(fallbackExecution.outcome.metadata?.type, 'mcp');
    const planTools = (fallbackExecution.outcome.result.plan || []).map((step) => step.tool);
    assert.deepEqual(planTools, ['invoiceLookup']);

    await fallbackMCP.shutdown();
});

test('LLM-driven planner follows model plan ordering and run flags', async () => {
    const planResponse = {
        plan: [
            { intent: 'summary', skill: 'llm-reporter-claude', input: 'Create opening summary', run: true, reason: 'Summaries lead' },
            { intent: 'data-fetch', skill: 'llm-data-lookup-mcp', input: 'Collect operational metrics', run: true, reason: 'Need raw values' },
            { intent: 'summary', skill: 'llm-reporter-claude', input: 'Wrap up with conclusion', run: false, reason: 'Optional closure' },
        ],
        notes: 'Plan provided by LLM',
    };

    const onExecutePrompt = (_, options = {}) => {
        const intent = options?.context?.intent;
        const skillName = options?.context?.skillName;
        if (intent === 'orchestrator-plan' && skillName === 'llm-planner-orchestrator') {
            return planResponse;
        }
        if (intent === 'mcp-skill-plan' && skillName === 'llm-data-lookup-mcp') {
            return {
                plan: [
                    { tool: 'metricScanner', arguments: 'Collect operational metrics', why: 'Matches requested data' },
                ],
                notes: 'Generated for test',
            };
        }
        return null;
    };

    const llmMCP = await createMiniMCPServer({
        tools: [
            {
                name: 'metricScanner',
                title: 'Metric Scanner',
                description: 'Collect operational metrics',
            },
            {
                name: 'inventoryLookup',
                title: 'Inventory Lookup',
                description: 'Inspect inventory levels',
            },
        ],
    });

    const agent = createAgent({ onExecutePrompt });

    assert.ok(agent.getSkillRecord('llm-data-lookup-mcp'), 'expected llm-data MCP skill to be registered');

    const availableTools = (await llmMCP.client.listTools({})).tools;

    const response = await agent.executePrompt('Prepare the executive rollup', {
        skillName: 'llm-planner-orchestrator',
        availableTools,
    });

    assert.equal(response.subsystem, 'orchestrator');
    assert.deepEqual(response.result.plan.map((step) => step.skill), planResponse.plan.map((step) => step.skill));

    const executions = response.result.executions;
    assert.equal(executions.length, planResponse.plan.length);
    const firstStep = executions[0];
    assert.equal(firstStep.skipped, false);
    assert.equal(firstStep.error, null);
    assert.ok(firstStep.outcome);
    assert.equal(firstStep.outcome.skill, 'llm-reporter-claude');

    const secondStep = executions[1];
    assert.equal(secondStep.skipped, false);
    assert.equal(secondStep.error, null);
    assert.ok(secondStep.outcome);
    assert.equal(secondStep.outcome.skill, 'llm-data-lookup-mcp');

    const thirdStep = executions[2];
    assert.ok(thirdStep.skipped, 'final planned step should be skipped');
    assert.equal(thirdStep.error, null);
    assert.equal(thirdStep.outcome, null);

    const mcpPlan = (secondStep.outcome.result.plan || []).map((step) => step.tool);
    assert.deepEqual(mcpPlan, ['metricScanner']);

    await llmMCP.shutdown();
});

test('Orchestrator rejects self invocation suggested by the model', async () => {
    const onExecutePrompt = (_, options = {}) => {
        if (options?.context?.intent === 'orchestrator-plan' && options.context?.skillName === 'llm-planner-orchestrator') {
            return {
                plan: [
                    { intent: 'summary', skill: 'llm-planner-orchestrator', input: 'Loop forever', run: true, reason: 'LLM hallucination' },
                ],
                notes: 'Should be rejected',
            };
        }
        return null;
    };

    const agent = createAgent({ onExecutePrompt });
    const response = await agent.executePrompt('Trigger recursive loop', {
        skillName: 'llm-planner-orchestrator',
    });

    assert.equal(response.subsystem, 'orchestrator');
    const execution = response.result.executions[0];
    assert.ok(execution.skipped, 'self invocation should be skipped');
    assert.match(execution.error || '', /cannot invoke themselves/i);
});
