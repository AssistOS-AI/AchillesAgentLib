import test from 'node:test';
import assert from 'node:assert/strict';

import {
    runInteractiveSkillScenario,
    resolveTestDir,
    isConfirmationPrompt,
} from '../helpers/runInteractiveSkillScenario.mjs';

const testDir = resolveTestDir(import.meta);

test('interactive skill stops execution when user cancels at confirmation time', async (t) => {
    const scenario = await runInteractiveSkillScenario({
        testDir,
        skillName: 'approve_purchase',
        taskDescription: 'Operations needs approval to buy new barcode scanners.',
        responses: [
            'Item name is industrial barcode scanners.',
            'Amount should be 2400 USD.',
            'cancel',
        ],
    });

    if (scenario.skipReason) {
        t.skip(scenario.skipReason);
        return;
    }

    assert.ok(scenario.error, 'Cancellation should surface an error');
    assert.match(String(scenario.error?.message || scenario.error), /cancelled/i, 'Error should mention cancellation');

    const confirmationPrompt = scenario.prompts.find((prompt) => isConfirmationPrompt(prompt));
    assert.ok(confirmationPrompt, 'Confirmation prompt should have been presented');
    assert.match(confirmationPrompt, /purchase approval/i, 'Confirmation should describe the business operation');
    assert.equal(scenario.skill, 'approve_purchase');
});
