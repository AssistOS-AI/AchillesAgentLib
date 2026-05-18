import test from 'node:test';
import assert from 'node:assert/strict';

test('package root and AgenticKnowledgeUnits subpath export the facade', async () => {
    const root = await import('ploinky-agent-lib');
    const subpath = await import('ploinky-agent-lib/AgenticKnowledgeUnits');
    assert.equal(typeof root.AgenticKnowledgeUnits, 'function');
    assert.equal(typeof subpath.AgenticKnowledgeUnits, 'function');
    assert.equal(root.AgenticKnowledgeUnits, subpath.AgenticKnowledgeUnits);
});
