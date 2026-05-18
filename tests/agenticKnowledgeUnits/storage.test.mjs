import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AtomicFileWriter } from '../../AgenticKnowledgeUnits/internal/atomic-write.mjs';
import { AKUFileStore } from '../../AgenticKnowledgeUnits/internal/storage.mjs';
import { resolveSafeRelative } from '../../AgenticKnowledgeUnits/internal/paths.mjs';
import { AKUError } from '../../AgenticKnowledgeUnits/index.mjs';

async function tempRoot() {
    return fs.mkdtemp(path.join(os.tmpdir(), 'aku-storage-'));
}

test('storage creates directories and round-trips JSON and JSONL atomically', async () => {
    const rootDir = await tempRoot();
    const store = new AKUFileStore({ rootDir });
    await store.ensureBaseLayout();
    const writer = new AtomicFileWriter({ akuRoot: store.akuRoot });

    await writer.transaction('storage-test', async (tx) => {
        await tx.writeJson(store.rootFile('sample.json'), { ok: true });
        await tx.writeJsonl(store.rootFile('sample.jsonl'), [{ a: 1 }, { b: 2 }]);
    });

    assert.deepEqual(await store.readJson(store.rootFile('sample.json')), { ok: true });
    assert.deepEqual(await store.readJsonl(store.rootFile('sample.jsonl')), [{ a: 1 }, { b: 2 }]);
    assert.deepEqual(await store.listPendingTransactions(), []);
});

test('safe relative path resolution rejects traversal, absolute paths, and symlinks', async () => {
    const rootDir = await tempRoot();
    await fs.writeFile(path.join(rootDir, 'safe.txt'), 'ok');
    await fs.symlink('/tmp', path.join(rootDir, 'linked'));

    const safe = await resolveSafeRelative(rootDir, 'safe.txt');
    assert.equal(safe.relative, 'safe.txt');

    await assert.rejects(() => resolveSafeRelative(rootDir, '../escape.txt'), AKUError);
    await assert.rejects(() => resolveSafeRelative(rootDir, path.join(rootDir, 'safe.txt')), AKUError);
    await assert.rejects(() => resolveSafeRelative(rootDir, 'linked/outside.txt'), AKUError);
});
