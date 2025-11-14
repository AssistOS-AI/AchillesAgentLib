import test from 'node:test';
import assert from 'node:assert/strict';

import { hasLLMKey, runDBTableScenario } from './helpers/runDBTableScenario.mjs';

test('dbtable skill creates a project and auto-generates the primary key', { concurrency: false }, async (t) => {
    if (!hasLLMKey()) {
        t.skip('LLM API key not configured (set OPENAI_API_KEY or ANTHROPIC_API_KEY).');
        return;
    }

    const { execution, persistoClient } = await runDBTableScenario({
        id: 'create-project',
        taskDescription: 'Create a new project called Atlas Initiative and mark it planned.',
        responses: [
            '- name: Atlas Initiative',
            '- status: planned',
            'accept',
        ],
        persistoSeed: {
            projects: {
                primaryKey: 'project_id',
                records: [
                    { project_id: 'PRJ-101', name: 'Baseline', status: 'complete' },
                ],
            },
        },
    });

    assert.ok(execution);
    assert.equal(execution.result.operation, 'create-record');
    assert.equal(execution.result.status, 'ok');
    assert.ok(execution.result.record.project_id.startsWith('PRJ-'));

    const stored = persistoClient.tables.get('projects').records.find((record) => record.name === 'Atlas Initiative');
    assert.ok(stored, 'Created project should be persisted.');
});
