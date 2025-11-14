import test from 'node:test';
import assert from 'node:assert/strict';

import { MockPersistoClient } from './helpers/runDBTableScenario.mjs';

test('MockPersistoClient exposes CRUD helpers per table', async () => {
    const client = new MockPersistoClient({
        projects: {
            primaryKey: 'project_id',
            records: [
                { project_id: 'PRJ-1', name: 'Alpha', status: 'planned' },
            ],
        },
        incidents: {
            tableName: 'support_incidents',
            primaryKey: 'incident_id',
            records: [
                { incident_id: 'INC-0010', summary: 'Printer jam', status: 'new' },
            ],
        },
    });

    const project = await client.getProjects('PRJ-1');
    assert.equal(project.name, 'Alpha');

    await client.updateProjects({ project_id: 'PRJ-1', name: 'Alpha', status: 'active' });
    const updated = await client.getProjects('PRJ-1');
    assert.equal(updated.status, 'active');

    await client.createProjects({ project_id: 'PRJ-2', name: 'Beta', status: 'planned' });
    const selection = await client.select('projects', { status: 'planned' });
    assert.equal(selection.length, 1);
    assert.equal(selection[0].project_id, 'PRJ-2');

    const incident = await client.getIncidents({ incident_id: 'INC-0010' });
    assert.equal(incident.summary, 'Printer jam');
});
