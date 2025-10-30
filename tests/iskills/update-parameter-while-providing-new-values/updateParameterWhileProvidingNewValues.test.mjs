import test from 'node:test';
import assert from 'node:assert/strict';

import {
    runInteractiveSkillScenario,
    resolveTestDir,
} from '../helpers/runInteractiveSkillScenario.mjs';

const testDir = resolveTestDir(import.meta);

test('interactive skill applies updates while adding new values in the same reply', async (t) => {
    const scenario = await runInteractiveSkillScenario({
        testDir,
        skillName: 'schedule_maintenance',
        taskDescription: 'Please line up service for the conveyor belt this week.',
        responses: [
            'Machine name is the primary conveyor belt.',
            'Priority should be high.',
            'window start is June 3rd.',
            'Actually set priority to medium, keep window start June 3rd, and set window end to July 12th.',
            'accept',
        ],
    });

    if (scenario.skipReason) {
        t.skip(scenario.skipReason);
        return;
    }

    assert.ifError(scenario.error);
    assert.ok(scenario.result, 'Execution should succeed');

    const confirmationPrompts = scenario.prompts.filter((prompt) => prompt.includes('About to apply'));
    assert.ok(confirmationPrompts.length >= 2, 'Agent should refresh the summary after updates');
    const revisedPrompt = confirmationPrompts.find((prompt) => /Priority: medium/i.test(prompt));
    assert.ok(revisedPrompt, 'Revised prompt should include the updated priority');
    assert.match(revisedPrompt, /Window Start: June 3rd/i);
    assert.match(revisedPrompt, /Window End: July 12th/i);

    const transcriptText = scenario.transcript.map(({ reply }) => reply).join('\n');
    assert.match(transcriptText, /set priority to medium/i);
    assert.match(transcriptText, /keep window start June 3rd/i);

    const result = scenario.result;
    assert.equal((result.priority || '').toLowerCase(), 'medium');
    assert.match((result.window_start || '').toLowerCase(), /june 3/);
    assert.match((result.window_end || '').toLowerCase(), /july 12/);
    assert.match((result.machine_name || '').toLowerCase(), /conveyor/);
});
