import test from 'node:test';
import assert from 'node:assert/strict';

import { hasLLMKey, runDBTableScenario } from './helpers/runDBTableScenario.mjs';

test('support incidents skill captures priority and assigned team', { concurrency: false }, async (t) => {
    if (!hasLLMKey()) {
        t.skip('LLM API key not configured (set OPENAI_API_KEY or ANTHROPIC_API_KEY).');
        return;
    }

    const { execution, persistoClient } = await runDBTableScenario({
        id: 'incidents-create',
        taskDescription: 'Create a support ticket for the dock printer outage.',
        responses: [
            '- summary: Dock printer offline at yard 7',
            '- priority: high',
            '- status: in_progress',
            '- assigned_team: warehouse ops',
            'accept',
        ],
        skillName: 'support-incidents-dbtable',
        persistoSeed: {
            incidents: {
                tableName: 'support_incidents',
                primaryKey: 'incident_id',
                records: [],
            },
        },
    });

    assert.ok(execution);
    assert.equal(execution.result.operation, 'create-record');
    assert.equal(execution.result.status, 'ok');
    assert.match(execution.result.recordTable, /Dock printer offline/i);
    assert.match(execution.result.recordTable, /Warehouse Ops/);

    const storedRecords = persistoClient.tables.get('incidents').records;
    assert.equal(storedRecords.length, 1);
});
