import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { LLMAgent } from '../../LLMAgents/index.mjs';
import AchillesCLI from '../../cli/achilles-cli/achilles-cli.mjs';
import { PLAN_INTENT } from '../../cli/achilles-cli/intentionToSkill.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURE_ROOT = path.join(__dirname, 'fixtures', 'planner');

const LIGHTSOP_SCRIPT = [
    '@prompt origin',
    '@clarify capture-requirements-interactive $origin "Clarify requested timeline details" clarification',
    '@outline draft-outline-code $origin "Produce milestone oriented outline" timeline',
].join('\n');

const buildPlanResponse = (steps) => JSON.stringify(steps, null, 2);

const createTestLLMAgent = () => new LLMAgent({
    name: 'PlannerTestLLM',
    invokerStrategy: async ({ prompt, context }) => {
        if (context?.intent === PLAN_INTENT) {
            if (prompt.includes('Consolidated reporting and analytics migration')) {
                return buildPlanResponse([
                    {
                        skill: 'project-router-orchestrator',
                        prompt: 'Collect requirements for analytics migration and compute delta between 120 and 95.',
                    },
                    {
                        skill: 'timeline-planner-orchestrator',
                        prompt: 'Produce a timeline for phased rollout of the analytics migration.',
                    },
                ]);
            }
            if (prompt.includes('Break the onboarding and rollout tasks')) {
                return buildPlanResponse([
                    {
                        skill: 'project-router-orchestrator',
                        prompt: 'Gather onboarding requirements and compute resource deltas for phase one.',
                    },
                    {
                        skill: 'project-router-orchestrator',
                        prompt: 'Compute delta for infrastructure sizing compared to legacy systems.',
                    },
                    {
                        skill: 'timeline-planner-orchestrator',
                        prompt: 'Draft a milestone timeline for deployment and training.',
                    },
                ]);
            }
            return buildPlanResponse([{
                skill: 'project-router-orchestrator',
                prompt: 'Handle the entire task.',
            }]);
        }

        if (typeof prompt === 'string' && prompt.includes('You are an assistant that emits LightSOPLang code.')) {
            return LIGHTSOP_SCRIPT;
        }

        return 'OK';
    },
});

test('Achilles CLI lists skills with types and implementation hints', async () => {
    const cli = new AchillesCLI({
        startDirs: [FIXTURE_ROOT],
        llmAgent: createTestLLMAgent(),
    });

    const list = await cli.listSkills();
    assert.ok(list.some((line) => line.includes('project-router-orchestrator')));
    assert.ok(list.some((line) => line.includes('timeline-planner-orchestrator')));
    assert.ok(list.some((line) => line.includes('compute-delta-code')));
    assert.ok(list.some((line) => line.toLowerCase().includes('soplang')));
});

test('Achilles CLI plans and executes across orchestrator skills', async () => {
    const cli = new AchillesCLI({
        startDirs: [FIXTURE_ROOT],
        llmAgent: createTestLLMAgent(),
    });

    const prompt = [
        'Consolidated reporting and analytics migration',
        'Compute the delta between the new and old metrics (120 vs 95)',
        'Provide a rollout timeline.',
    ].join(' ');

    const { plan, executions } = await cli.processTaskInput(prompt);

    assert.equal(plan.length, 2);
    assert.equal(plan[0].skill, 'project-router-orchestrator');
    assert.equal(plan[1].skill, 'timeline-planner-orchestrator');

    assert.equal(executions.length, 2);
    executions.forEach((entry) => {
        assert.equal(entry.status, 'ok');
        assert.ok(entry.result, 'expected execution result payload');
    });
});

test('Achilles CLI handles prompts requiring repeated orchestrator usage', async () => {
    const cli = new AchillesCLI({
        startDirs: [FIXTURE_ROOT],
        llmAgent: createTestLLMAgent(),
    });

    const prompt = [
        'Break the onboarding and rollout tasks into actionable steps,',
        'compute resource deltas, and prepare a deployment timeline.',
    ].join(' ');

    const { plan, executions } = await cli.processTaskInput(prompt);

    assert.equal(plan.length, 3);
    assert.equal(plan.filter((step) => step.skill === 'project-router-orchestrator').length, 2);
    assert.equal(plan.filter((step) => step.skill === 'timeline-planner-orchestrator').length, 1);

    assert.equal(executions.length, 3);
    executions.forEach((entry) => {
        assert.equal(entry.status, 'ok');
    });
});
