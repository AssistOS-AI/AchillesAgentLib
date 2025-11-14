import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
    runInteractiveSkillScenario,
    resolveTestDir,
    isConfirmationPrompt,
} from '../helpers/runInteractiveSkillScenario.mjs';

const testDir = resolveTestDir(import.meta);
const mappingPath = path.join(testDir, 'fixtures', 'inventoryMapping.json');
const mapping = JSON.parse(fs.readFileSync(mappingPath, 'utf8'));

test('interactive skill maps between human-friendly names and technical IDs', async (t) => {
    const responses = [
        'Source warehouse is Berlin Central Warehouse.',
        'Destination should be Munich Flagship Store.',
        'Transfer the Skyline Display Units.',
        'We need 25 units.',
        'accept.',
    ];

    const scenario = await runInteractiveSkillScenario({
        testDir,
        skillName: 'assign_inventory_transfer',
        taskDescription: 'Move the skyline display units from Berlin central to Munich flagship.',
        responses,
    });

    if (scenario.skipReason) {
        t.skip(scenario.skipReason);
        return;
    }

    assert.ifError(scenario.error);
    assert.ok(scenario.result, 'Scenario should return a payload');

    const confirmationPrompts = scenario.prompts.filter((prompt) => isConfirmationPrompt(prompt));
    assert.ok(confirmationPrompts.length >= 1, 'Agent should present at least one confirmation prompt');

    for (const promptText of confirmationPrompts) {
        assert.match(promptText, /Berlin Central Warehouse/i);
        assert.match(promptText, /Munich Flagship Store/i);
        assert.match(promptText, /Skyline Display Units/i);
    }

    const { sourceWarehouses, destinationWarehouses, skus } = mapping;
    assert.equal(scenario.result.source_warehouse_id, sourceWarehouses['Berlin Central Warehouse'].id);
    assert.equal(scenario.result.destination_warehouse_id, destinationWarehouses['Munich Flagship Store'].id);
    assert.equal(scenario.result.sku_id, skus['Skyline Display Units'].id);
    assert.equal(scenario.result.quantity, 25);
});
