import test from 'node:test';
import assert from 'node:assert/strict';

import {
    runInteractiveSkillScenario,
    resolveTestDir,
} from '../helpers/runInteractiveSkillScenario.mjs';

const testDir = resolveTestDir(import.meta);

test('interactive skill allows revising a prior parameter while adding a new one', async (t) => {
    const scenario = await runInteractiveSkillScenario({
        testDir,
        skillName: 'schedule_project_rotation',
        taskDescription: 'Line up the Phoenix rotation for engineering.',
        responses: [
            'Project code is Phoenix-21.',
            'Location should be Berlin office.',
            'We start on June 3rd.',
            'We wrap up July 12th.',
            'Supervisor is Maria Gomez.',
            'Actually make supervisor Alex Smith and add backup supervisor Jordan Lee.',
            'Priority should be medium.',
            'accept',
        ],
    });

    if (scenario.skipReason) {
        t.skip(scenario.skipReason);
        return;
    }

    assert.ifError(scenario.error);
    assert.ok(scenario.result, 'Execution should eventually complete');

    const prompts = scenario.prompts || [];
    const initialSummaryIndex = prompts.findIndex((prompt) => /Maria Gomez/i.test(prompt));
    assert.ok(initialSummaryIndex >= 0, 'Initial confirmation should reference the original supervisor');

    const revisedSummaryIndex = prompts.findIndex((prompt, index) => index > initialSummaryIndex && /Alex Smith/i.test(prompt));
    assert.ok(revisedSummaryIndex >= 0, 'A later confirmation should reference the revised supervisor');

    const finalSummary = prompts[prompts.length - 1] || '';
    assert.match(finalSummary, /Alex Smith/i);
    assert.match(finalSummary, /Jordan Lee/i);
    assert.match(finalSummary, /\|\s*Priority\s*\|[^|]*medium/i);

    const transcriptText = scenario.transcript.map(({ prompt, reply }) => `${prompt}\n${reply}`).join('\n');
    assert.match(transcriptText, /make supervisor Alex Smith/i);
    assert.match(transcriptText, /backup supervisor Jordan Lee/i);

    const result = scenario.result;
    assert.equal(result.project_code, 'Phoenix-21');
    assert.match(String(result.location || ''), /Berlin/i);
    assert.ok(result.start_date);
    assert.ok(result.end_date);
    assert.match(String(result.supervisor || ''), /Alex Smith/i);
    assert.match(JSON.stringify(result), /Jordan Lee/);
    assert.equal((result.priority || '').toLowerCase(), 'medium');
});
