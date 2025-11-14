import test from 'node:test';
import assert from 'node:assert/strict';

import { hasLLMKey, runDBTableScenario } from './helpers/runDBTableScenario.mjs';

test('dbtable skill updates an existing project status interactively', { concurrency: false }, async (t) => {
    if (!hasLLMKey()) {
        t.skip('LLM API key not configured (set OPENAI_API_KEY or ANTHROPIC_API_KEY).');
        return;
    }

    const { execution, persistoClient } = await runDBTableScenario({
        id: 'update-project-status',
        taskDescription: 'Update project PRJ-300 to active status.',
        responses: [
            'Project code is PRJ-300',
            'status should be active',
            'accept',
        ],
        persistoSeed: {
            projects: {
                primaryKey: 'project_id',
                records: [
                    { project_id: 'PRJ-300', name: 'Beacon', status: 'planned' },
                ],
            },
        },
    });

    assert.ok(execution);
    assert.equal(execution.result.operation, 'update-record');
    assert.equal(execution.result.record.status.toLowerCase(), 'active');
    const stored = persistoClient.tables.get('projects').records[0];
    assert.strictEqual(stored.status, 'active');
});
