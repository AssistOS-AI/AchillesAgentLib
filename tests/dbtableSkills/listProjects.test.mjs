import test from 'node:test';
import assert from 'node:assert/strict';

import { hasLLMKey, runDBTableScenario } from './helpers/runDBTableScenario.mjs';

test('dbtable skill lists existing projects as markdown table', { concurrency: false }, async (t) => {
    if (!hasLLMKey()) {
        t.skip('LLM API key not configured (set OPENAI_API_KEY or ANTHROPIC_API_KEY).');
        return;
    }

    const { execution } = await runDBTableScenario({
        id: 'list-projects',
        taskDescription: 'List every project tracked in the delivery portfolio.',
        responses: ['accept'],
        persistoSeed: {
            projects: {
                primaryKey: 'project_id',
                records: [
                    { project_id: 'PRJ-100', name: 'Migration', status: 'active' },
                    { project_id: 'PRJ-200', name: 'Launch', status: 'planned' },
                ],
            },
        },
    });

    assert.ok(execution, 'Execution payload should be present.');
    assert.equal(execution.result.operation, 'display-table');
    assert.match(execution.result.markdown, /\| Project ID/i);
    assert.match(execution.result.markdown, /PRJ-100/);
    assert.match(execution.result.markdown, /PRJ-200/);
});
