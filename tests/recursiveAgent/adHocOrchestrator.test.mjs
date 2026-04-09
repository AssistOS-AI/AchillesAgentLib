import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { RecursiveSkilledAgent } from '../../RecursiveSkilledAgents/RecursiveSkilledAgent.mjs';
import { LLMAgent } from '../../LLMAgents/LLMAgent.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const AD_HOC_FIXTURES = path.join(__dirname, 'adHocFixtures');
const SINGLE_FIXTURES = path.join(__dirname, 'adHocSingleFixtures');

/**
 * Create a mock LLM agent that tracks calls and returns controllable responses.
 * The mock handles:
 * - agentic-session-planner: loop agent planner decisions (tool calls / final answers)
 * - recursive-skill-selection: LLM-based skill selection (fallback, should not be reached)
 * - Other prompts: returns a simple text response
 */
function createMockLLMAgent({ onComplete = null } = {}) {
    const calls = [];

    const agent = new LLMAgent({
        name: 'AdHocTestAgent',
        invokerStrategy: async ({ prompt, tier, context }) => {
            const intent = context?.intent || '';
            const userPrompt = context?.userPrompt || '';
            calls.push({ prompt, tier, intent, userPrompt });

            if (typeof onComplete === 'function') {
                const override = onComplete({ prompt, tier, intent, userPrompt, context });
                if (override !== undefined) {
                    return typeof override === 'string' ? override : JSON.stringify(override);
                }
            }

            // Loop agent planner: return final answer
            if (intent === 'agentic-session-planner') {
                return JSON.stringify({
                    action: 'final_answer',
                    text: 'Ad-hoc orchestration completed successfully.',
                });
            }

            // Skill selection fallback (should not be reached with ad-hoc orchestrator)
            if (intent === 'recursive-skill-selection') {
                return 'none';
            }

            // Default: simple response
            return 'Mock LLM response';
        },
    });

    return { agent, calls };
}

// Internal skills dir — always included by RecursiveSkilledAgent via additionalSkillRoots
const INTERNAL_SKILLS_DIR = path.resolve(__dirname, '..', '..', 'skills');

function createAdHocAgent(options = {}) {
    const { agent, calls } = createMockLLMAgent(options);
    const fixtureDir = options.startDir || AD_HOC_FIXTURES;

    // Scope skill discovery to the fixture dir + internal skills only.
    // Without this, process.cwd() causes discovery of skills from other test fixtures.
    const skillFilter = ({ skillDir }) => {
        if (skillDir?.startsWith(fixtureDir)) return true;
        if (skillDir?.startsWith(INTERNAL_SKILLS_DIR)) return true;
        return false;
    };

    const recursiveAgent = new RecursiveSkilledAgent({
        llmAgent: agent,
        startDir: fixtureDir,
        skillFilter,
        exposeInternalSkills: options.exposeInternalSkills ?? false,
        fallbackSessionType: options.fallbackSessionType || 'loop',
        tierConfig: options.tierConfig || undefined,
    });
    return { agent: recursiveAgent, calls };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

test('Ad-hoc orchestrator: no orchestrator skill triggers ad-hoc orchestration', async () => {
    const { agent, calls } = createAdHocAgent();

    // Verify no orchestrator skills are registered
    const orchestrators = agent.registry.listByType('orchestrator');
    assert.equal(orchestrators.length, 0, 'fixture should have no orchestrator skills');

    // Verify we have multiple non-orchestrator skills
    const allSkills = agent.registry.getAll();
    const userSkills = allSkills.filter(s => !s.isInternal);
    assert.ok(userSkills.length >= 2, `expected at least 2 user skills, got ${userSkills.length}`);

    // Execute without explicit skill — should trigger ad-hoc orchestration
    const response = await agent.executePrompt('Summarize and classify the following text: AI is transforming healthcare.');

    assert.equal(response.subsystem, 'orchestrator', 'should use orchestrator subsystem');
    assert.equal(response.adHoc, true, 'should be marked as ad-hoc');
    assert.equal(response.reviewMode, 'none');

    // Verify the planner was called (agentic-session-planner intent)
    const plannerCalls = calls.filter(c => c.intent === 'agentic-session-planner');
    assert.ok(plannerCalls.length >= 1, 'loop agent planner should have been called');

    agent.shutdown();
});

test('Ad-hoc orchestrator: single skill executes directly without orchestration', async () => {
    const { agent } = createAdHocAgent({
        startDir: SINGLE_FIXTURES,
    });

    // Verify only one non-internal skill after filtering
    const allSkills = agent.registry.getAll();
    const userSkills = allSkills.filter(s => !s.isInternal);
    assert.equal(userSkills.length, 1, 'fixture should have exactly 1 user skill');

    // Execute — should go directly to the single skill, not ad-hoc orchestration
    const response = await agent.executePrompt('Process this data.');

    assert.equal(response.subsystem, 'anthropic', 'should execute via anthropic subsystem directly');
    assert.equal(response.adHoc, undefined, 'should not be marked as ad-hoc');

    agent.shutdown();
});

test('Ad-hoc orchestrator: respects exposeInternalSkills=false', async () => {
    const { agent } = createAdHocAgent({
        exposeInternalSkills: false,
    });

    // With exposeInternalSkills=false, internal skills should not be in the catalog
    // for LLM selection, but the ad-hoc orchestrator filters them from candidates
    const allSkills = agent.registry.getAll();
    const internalSkills = allSkills.filter(s => s.isInternal);
    const nonInternalSkills = allSkills.filter(s => !s.isInternal);

    // Internal skills still registered (for programmatic use) but not exposed
    assert.ok(nonInternalSkills.length >= 2, 'should have user skills');

    // Execute — ad-hoc orchestrator should not include internal skills as tools
    const response = await agent.executePrompt('Analyze this text.');
    assert.equal(response.adHoc, true, 'should use ad-hoc orchestration');

    agent.shutdown();
});

test('Ad-hoc orchestrator: fallbackSessionType=sop uses SOP session', async () => {
    const { agent, calls } = createAdHocAgent({
        fallbackSessionType: 'sop',
        // SOP sessions use startSOPLangAgentSession which the mock LLM handles differently
    });

    assert.equal(agent.fallbackSessionType, 'sop');

    const response = await agent.executePrompt('Classify and summarize this report.');

    assert.equal(response.subsystem, 'orchestrator', 'should use orchestrator subsystem');
    assert.equal(response.adHoc, true, 'should be marked as ad-hoc');
    assert.equal(response.session, 'sop', 'should use SOP session type');

    agent.shutdown();
});

test('Ad-hoc orchestrator: fallbackSessionType defaults to loop', async () => {
    const { agent } = createAdHocAgent();

    assert.equal(agent.fallbackSessionType, 'loop');

    const response = await agent.executePrompt('Summarize this text about technology.');
    assert.equal(response.adHoc, true);
    assert.equal(response.session, 'loop', 'should use loop session type');

    agent.shutdown();
});

test('Ad-hoc orchestrator: tierConfig flows to ad-hoc session', async () => {
    const customTierConfig = { plan: 'deep', execution: 'fast', code: 'code' };
    const { agent, calls } = createAdHocAgent({
        tierConfig: customTierConfig,
    });

    // tierConfig expands with skillPlan/skillExec defaults
    assert.equal(agent.tierConfig.plan, 'deep');
    assert.equal(agent.tierConfig.execution, 'fast');
    assert.equal(agent.tierConfig.code, 'code');
    assert.equal(agent.tierConfig.skillPlan, 'deep', 'skillPlan should default to plan tier');

    const response = await agent.executePrompt('Analyze this data set.');
    assert.equal(response.adHoc, true);

    // The planner calls should use the plan tier from tierConfig
    const plannerCalls = calls.filter(c => c.intent === 'agentic-session-planner');
    assert.ok(plannerCalls.length >= 1, 'planner should have been called');
    assert.equal(plannerCalls[0].tier, 'deep', 'planner should use tierConfig.plan tier');

    agent.shutdown();
});

test('Ad-hoc orchestrator: explicit orchestrator takes precedence over ad-hoc', async () => {
    // Use the existing fixtures that HAVE an orchestrator
    const ORCHESTRATOR_FIXTURES = path.join(__dirname, 'recursiveAgentFixtures');

    const { agent: llmAgent } = createMockLLMAgent({
        onComplete: ({ intent, context }) => {
            // Handle orchestrator plan generation
            if (intent === 'agentic-session-planner') {
                return { action: 'final_answer', text: 'Explicit orchestrator result' };
            }
            return undefined;
        },
    });

    const agent = new RecursiveSkilledAgent({
        llmAgent,
        startDir: ORCHESTRATOR_FIXTURES,
        searchUpwards: false,
        exposeInternalSkills: false,
    });

    // Should have orchestrator skills
    const orchestrators = agent.registry.listByType('orchestrator');
    assert.ok(orchestrators.length > 0, 'fixture should have orchestrator skills');

    const response = await agent.executePrompt('Prepare warehouse report');
    assert.equal(response.subsystem, 'orchestrator');
    assert.equal(response.adHoc, undefined, 'should NOT be ad-hoc when explicit orchestrator exists');

    agent.shutdown();
});
