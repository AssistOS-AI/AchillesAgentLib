import test from 'node:test';
import assert from 'node:assert/strict';

import {
    runInteractiveSkillScenario,
    resolveTestDir,
    isConfirmationPrompt,
} from '../helpers/runInteractiveSkillScenario.mjs';

const testDir = resolveTestDir(import.meta);

test('interactive skill treats enumerated values as case-insensitive', async (t) => {
    const scenario = await runInteractiveSkillScenario({
        testDir,
        skillName: 'assign_distribution_region',
        taskDescription: 'Route resupply batches to the correct operations center.',
        responses: [
            'REGION SHOULD BE CENTER 11.',
            'accept',
        ],
    });

    if (scenario.skipReason) {
        t.skip(scenario.skipReason);
        return;
    }

    assert.ifError(scenario.error);
    assert.equal(scenario.result, 'DC-11', 'Should resolve to DC-11 technical value');
    assert.equal(scenario.skill, 'assign_distribution_region');

    const confirmationPrompt = scenario.prompts.find((prompt) =>
        isConfirmationPrompt(prompt) && /Center 11/i.test(prompt)
    );
    assert.ok(confirmationPrompt, 'A confirmation prompt should be presented');
});
