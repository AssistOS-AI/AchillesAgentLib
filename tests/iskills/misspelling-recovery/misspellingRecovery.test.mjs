import test from 'node:test';
import assert from 'node:assert/strict';

import {
    runInteractiveSkillScenario,
    resolveTestDir,
    isConfirmationPrompt,
} from '../helpers/runInteractiveSkillScenario.mjs';

const testDir = resolveTestDir(import.meta);

test('interactive skill recovers from small misspellings in enumerated values', async (t) => {
    const scenario = await runInteractiveSkillScenario({
        testDir,
        skillName: 'schedule_resupply',
        taskDescription: 'Restock the flagship stores.',
        responses: [
            'Target warehouse is berlin central warehous.',
            'Quantity should be 40.',
            'accept',
        ],
    });

    if (scenario.skipReason) {
        t.skip(scenario.skipReason);
        return;
    }

    assert.ifError(scenario.error);
    assert.ok(scenario.result, 'Scenario should produce a payload');

    const confirmation = scenario.prompts.find((prompt) => isConfirmationPrompt(prompt));
    assert.ok(confirmation, 'Confirmation prompt should be presented');
    assert.match(confirmation, /Berlin Central Warehouse/i);

    assert.equal(scenario.result.target_warehouse_id, 'WH-DE-01');
    assert.equal(scenario.result.quantity, 40);
});
