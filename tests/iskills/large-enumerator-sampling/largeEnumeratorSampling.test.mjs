import test from 'node:test';
import assert from 'node:assert/strict';

import {
    runInteractiveSkillScenario,
    resolveTestDir,
    isConfirmationPrompt,
} from '../helpers/runInteractiveSkillScenario.mjs';

const testDir = resolveTestDir(import.meta);

test('interactive skill accepts enumerator values beyond sampled list', async (t) => {
    const scenario = await runInteractiveSkillScenario({
        testDir,
        skillName: 'assign_distribution_region',
        taskDescription: 'Route resupply batches to the correct operations center.',
        responses: [
            'Region should be Center 11.',
            'accept',
        ],
    });

    if (scenario.skipReason) {
        t.skip(scenario.skipReason);
        return;
    }

    assert.ifError(scenario.error);
    assert.equal(scenario.result, 'DC-11', 'Should accept Center 11 even if not shown in prompt samples');

    const confirmationPrompt = scenario.prompts.find((prompt) =>
        isConfirmationPrompt(prompt) && /Center 11/i.test(prompt)
    );
    assert.ok(confirmationPrompt, 'Confirmation prompt should be present');
});
