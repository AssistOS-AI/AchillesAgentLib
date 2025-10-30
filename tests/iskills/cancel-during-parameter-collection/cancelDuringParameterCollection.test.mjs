import test from 'node:test';
import assert from 'node:assert/strict';

import {
    runInteractiveSkillScenario,
    resolveTestDir,
} from '../helpers/runInteractiveSkillScenario.mjs';

const testDir = resolveTestDir(import.meta);

test('interactive skill stops when user cancels during parameter collection', async (t) => {
    const scenario = await runInteractiveSkillScenario({
        testDir,
        skillName: 'deploy_update',
        taskDescription: 'Prepare the POS rollout.',
        responses: [
            'Store group is East Coast flagships.',
            'Deployment date should be 3rd of next month.',
            'Actually cancel this rollout.',
        ],
    });

    if (scenario.skipReason) {
        t.skip(scenario.skipReason);
        return;
    }

    assert.ok(scenario.error, 'Cancellation should propagate an error');
    assert.match(String(scenario.error?.message || scenario.error), /cancelled/i, 'Error should mention cancellation');

    assert.equal(scenario.remainingResponses.length, 0, 'All scripted responses should be consumed');

    const combinedText = [
        scenario.logs.join('\n'),
        scenario.prompts.join('\n'),
    ].join('\n');

    assert.match(combinedText, /To continue I need the following details:/, 'Agent should surface missing details before cancellation');
    assert.match(combinedText, /Maintenance window approval/i, 'Optional parameters should appear in the prompt');
    assert.equal(scenario.skill, 'deploy_update');
});
