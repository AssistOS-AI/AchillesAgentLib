import test from 'node:test';
import assert from 'node:assert/strict';

import { hasLLMKey, runDBTableScenario } from './helpers/runDBTableScenario.mjs';

test('dbtable skill prompts multiple times until required fields are provided', { concurrency: false }, async (t) => {
    if (!hasLLMKey()) {
        t.skip('LLM API key not configured (set OPENAI_API_KEY or ANTHROPIC_API_KEY).');
        return;
    }

    const { execution } = await runDBTableScenario({
        id: 'required-prompts',
        taskDescription: 'Add a project but I only know that status is planned.',
        responses: [
            '- status: planned',
            '- name: Canary Rollout',
            '- status: planned',
            'accept',
        ],
        persistoSeed: {
            projects: {
                primaryKey: 'project_id',
                records: [],
            },
        },
    });

    assert.ok(execution);
    assert.equal(execution.result.operation, 'create-record');
    assert.equal(execution.result.status, 'ok');
    assert.match(execution.result.record.name, /Canary Rollout/i);
});
