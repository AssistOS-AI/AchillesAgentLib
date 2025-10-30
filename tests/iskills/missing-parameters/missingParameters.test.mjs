import test from 'node:test';
import assert from 'node:assert/strict';

import {
    runInteractiveSkillScenario,
    resolveTestDir,
} from '../helpers/runInteractiveSkillScenario.mjs';

const testDir = resolveTestDir(import.meta);

test('interactive skill asks for missing parameters in business language and confirms execution summary', async (t) => {
    const scenario = await runInteractiveSkillScenario({
        testDir,
        skillName: 'file_incident',
        taskDescription: 'The packaging printers keep jamming and nothing gets printed.',
        responses: [
            'Incident title is Warehouse printer outage.',
            'Severity should be high.',
            'Assigned team is warehouse support.',
            'accept',
        ],
    });

    if (scenario.skipReason) {
        t.skip(scenario.skipReason);
        return;
    }

    assert.ifError(scenario.error);
    assert.ok(scenario.result, 'Execution should produce a payload');
    assert.equal((scenario.result.severity || '').toLowerCase(), 'high');

    const collectedText = scenario.logs.join('\n');
    const missingDetailsMentions = collectedText.match(/To continue I need the following details:/g) || [];
    assert.ok(missingDetailsMentions.length >= 1, 'The agent should list missing details');
    assert.match(collectedText, /Incident Title/i);
    assert.match(collectedText, /Incident severity level/i);
    assert.match(collectedText, /Optional details you may add:[^\n]*\n[\s\S]*Team that will follow up on the incident\./i);
    assert.ok(!/skill/i.test(collectedText), 'Prompts should avoid the word "skill"');

    const confirmationPrompt = scenario.prompts.find((prompt) => prompt.includes('About to apply'));
    assert.ok(confirmationPrompt, 'Confirmation prompt should appear before execution');
    assert.ok(confirmationPrompt.includes('a support incident record for the warehouse printers'));
    assert.ok(confirmationPrompt.includes('Incident Title'));
    assert.ok(confirmationPrompt.includes('Severity'));
    assert.ok(!/skill/i.test(confirmationPrompt), 'Confirmation prompt should avoid technical jargon');

    assert.match((scenario.result.incident_title || '').toLowerCase(), /printer/);
});
