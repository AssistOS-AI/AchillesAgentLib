import test from 'node:test';
import assert from 'node:assert/strict';

import { hasLLMKey, runDBTableScenario } from './helpers/runDBTableScenario.mjs';

test('hr employees skill derives badge state from status', { concurrency: false }, async (t) => {
    if (!hasLLMKey()) {
        t.skip('LLM API key not configured (set OPENAI_API_KEY or ANTHROPIC_API_KEY).');
        return;
    }

    const { execution } = await runDBTableScenario({
        id: 'employees-badge-state',
        taskDescription: 'Onboard a new engineer named Nico Rivera.',
        responses: [
            '- full_name: Nico Rivera',
            '- department: engineering',
            '- status: active',
            'accept',
        ],
        skillName: 'hr-employees-dbtable',
        persistoSeed: {
            employees: {
                tableName: 'hr_employees',
                primaryKey: 'employee_id',
                records: [],
            },
        },
    });

    assert.ok(execution);
    assert.equal(execution.result.operation, 'create-record');
    assert.match(execution.result.recordTable, /Badge State/);
});
