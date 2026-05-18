import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AgenticKnowledgeUnits, AKUError } from '../../AgenticKnowledgeUnits/index.mjs';

async function fixture() {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aku-security-'));
    const aku = new AgenticKnowledgeUnits({ rootDir, actor: 'test' });
    await aku.initAKU();
    const ku = await aku.initKU({ ku_name: 'Security KU' });
    await fs.writeFile(path.join(rootDir, 'safe.txt'), 'safe');
    await fs.writeFile(path.join(rootDir, '.env'), 'SECRET=1');
    await fs.symlink('/tmp', path.join(rootDir, 'linked'));
    return { rootDir, aku, ku };
}

test('record paths reject traversal, absolute paths, symlinks, and sensitive paths', async () => {
    const { rootDir, aku, ku } = await fixture();
    await assert.rejects(() => aku.registerFile(ku.ku_id, { path: '../outside.txt' }), AKUError);
    await assert.rejects(() => aku.registerFile(ku.ku_id, { path: path.join(rootDir, 'safe.txt') }), AKUError);
    await assert.rejects(() => aku.registerFile(ku.ku_id, { path: 'linked/outside.txt' }), AKUError);
    await assert.rejects(() => aku.registerFile(ku.ku_id, { path: '.env' }), AKUError);
    await assert.rejects(() => aku.recordDocument(ku.ku_id, { title: 'Bad path', path: '../outside.md' }), AKUError);
});

test('sensitive metadata fields are excluded from search indexes', async () => {
    const { rootDir, aku, ku } = await fixture();
    await aku.recordDocument(ku.ku_id, {
        title: 'Public Document',
        summary: 'ordinary visible summary',
        metadata: {
            password: 'supersecretpassword',
            token: 'supersecrettoken',
        },
    });
    const indexText = await fs.readFile(path.join(rootDir, '.aku/search-index.jsonl'), 'utf8');
    assert.equal(indexText.includes('supersecretpassword'), false);
    assert.equal(indexText.includes('supersecrettoken'), false);
    const result = await aku.search('supersecretpassword');
    assert.equal(result.results.length, 0);
});
