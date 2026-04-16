import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { MarkdownDataStore } from '../../index.mjs';

async function createSandbox() {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'achilles-mdstore-'));
    return {
        dataDir: root,
        async cleanup() {
            await fs.rm(root, { recursive: true, force: true });
        },
    };
}

test('MarkdownDataStore creates, updates and selects sections', async (t) => {
    const sandbox = await createSandbox();
    t.after(async () => sandbox.cleanup());

    const store = new MarkdownDataStore({ dataDir: sandbox.dataDir });
    const first = await store.updateFile('sessions', 'session-1', {
        Profile: '- Developer',
        History: '- User asked for docs',
    });
    assert.equal(first.fileName, 'session-1');
    assert.equal(first.createdSections.length, 2);

    const second = await store.updateFile('sessions', 'session-1', {
        History: '- Agent answered',
    });
    assert.equal(second.updatedSections.length, 1);

    const full = await store.getFile('sessions', 'session-1');
    assert.equal(full.sections.length, 2);
    assert.match(full.rawMarkdown, /### 1\. Profile/);
    assert.match(full.rawMarkdown, /### 2\. History/);
    assert.match(full.rawMarkdown, /- Agent answered/);

    const byName = await store.getFile('sessions', 'session-1', ['History']);
    assert.equal(byName.sections.length, 1);
    assert.equal(byName.sections[0].name, 'History');

    const byIndex = await store.getFile('sessions', 'session-1', [1]);
    assert.equal(byIndex.sections.length, 1);
    assert.equal(byIndex.sections[0].name, 'Profile');
});

test('MarkdownDataStore lists items and deletes sections/files', async (t) => {
    const sandbox = await createSandbox();
    t.after(async () => sandbox.cleanup());

    const store = new MarkdownDataStore({ dataDir: sandbox.dataDir });
    await store.updateFile('profilesInfo', 'developer', {
        Characteristics: '- Technical',
        Interests: '- APIs',
        'Qualifying criteria': '- Wants integration help',
    });

    const listResult = await store.listFiles('profilesInfo');
    assert.deepEqual(listResult.files, ['developer']);

    const deleteSection = await store.deleteFile('profilesInfo', 'developer', ['Interests']);
    assert.equal(deleteSection.deletedSections.length, 1);
    assert.equal(deleteSection.deletedSections[0].name, 'Interests');
    assert.match(deleteSection.rawMarkdown, /### 1\. Characteristics/);
    assert.match(deleteSection.rawMarkdown, /### 2\. Qualifying criteria/);

    const deleteFile = await store.deleteFile('profilesInfo', 'developer');
    assert.equal(deleteFile.deletedFile, true);
});

test('MarkdownDataStore supports replace/append/map/stats and normalizes empty text to *None*', async (t) => {
    const sandbox = await createSandbox();
    t.after(async () => sandbox.cleanup());

    const store = new MarkdownDataStore({ dataDir: sandbox.dataDir });
    await store.replaceFile('sessions', 'session-2', {
        Profile: '',
        History: '- User: hello',
    });
    await store.appendToFile('sessions', 'session-2', {
        sections: {
            History: '- Agent: hi',
        },
    });

    const mapped = await store.getSectionMap('sessions', 'session-2');
    assert.equal(mapped.sections.Profile, '*None*');
    assert.match(mapped.sections.History, /User: hello/);
    assert.match(mapped.sections.History, /Agent: hi/);

    const stats = await store.getFileStats('sessions', 'session-2');
    assert.equal(stats.fileName, 'session-2');
    assert.ok(Number.isFinite(stats.stats.mtimeMs));
});
