import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseTSkillDocument } from '../../DBTableSkillsSubsystem/parser/parseTSkillDocument.mjs';

const FIXTURE_DIR = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    'fixtures/.AchillesSkills/dbSuite/projects',
);

test('parseTSkillDocument extracts field metadata and ordering', () => {
    const descriptorPath = path.join(FIXTURE_DIR, 'tskill.md');
    const parsed = parseTSkillDocument(descriptorPath);

    assert.equal(parsed.tableName, 'projects');
    assert.equal(parsed.fields.length, 3);
    assert.deepEqual(parsed.primaryKeys, ['project_id']);

    const idField = parsed.fields.find((field) => field.name === 'project_id');
    assert.ok(idField);
    assert.equal(idField.displayName, 'Project ID');
    assert.deepEqual(idField.aliases, ['id', 'project code', 'ticket']);
    assert.ok(idField.primaryKey);

    const statusField = parsed.fields.find((field) => field.name === 'status');
    assert.ok(statusField);
    assert.deepEqual(
        statusField.enumeratorSamples,
        [
            { label: 'planned', value: 'planned', description: 'scheduled but not started' },
            { label: 'active', value: 'active', description: 'currently being worked on' },
            { label: 'complete', value: 'complete', description: 'fully delivered' },
        ],
    );
});
