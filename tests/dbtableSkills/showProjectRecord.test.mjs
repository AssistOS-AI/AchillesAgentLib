import test from 'node:test';
import assert from 'node:assert/strict';

import { hasLLMKey, runDBTableScenario } from './helpers/runDBTableScenario.mjs';

test('dbtable skill displays a specific project record after collecting identifiers', { concurrency: false }, async (t) => {
    if (!hasLLMKey()) {
        t.skip('LLM API key not configured (set OPENAI_API_KEY or ANTHROPIC_API_KEY).');
        return;
    }

    const { execution } = await runDBTableScenario({
        id: 'show-project-record',
        taskDescription: 'Show the details for project PRJ-200.',
        responses: [
            'Project id is PRJ-200',
            'accept',
        ],
        persistoSeed: {
            projects: {
                primaryKey: 'project_id',
                records: [
                    { project_id: 'PRJ-150', name: 'Revamp', status: 'active' },
                    { project_id: 'PRJ-200', name: 'Launch Readiness', status: 'planned' },
                ],
            },
        },
    });

    assert.ok(execution);
    assert.equal(execution.result.operation, 'display-record');
    assert.equal(execution.result.record.project_id, 'PRJ-200');
    assert.match(execution.result.markdown, /Launch Readiness/);
});
