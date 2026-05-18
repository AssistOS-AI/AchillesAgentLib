import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AgenticKnowledgeUnits } from '../../AgenticKnowledgeUnits/index.mjs';

async function fixture() {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aku-indexing-'));
    const aku = new AgenticKnowledgeUnits({ rootDir, actor: 'test' });
    await aku.initAKU({ name: 'indexing' });
    const ku = await aku.initKU({
        ku_name: 'Indexing KU',
        ku_type: 'design',
        tags: ['indexing'],
        keywords: ['BM25F'],
        summary: 'Index rebuild source of truth',
    });
    await aku.recordDocument(ku.ku_id, { title: 'Search Index', summary: 'JSONL cache with checksums' });
    await aku.recordResult(ku.ku_id, { title: 'Index Result', summary: 'Stats include document frequency', status: 'validated' });
    return { rootDir, aku, ku };
}

test('rebuild writes stats, metadata, checksums, and in-memory postings', async () => {
    const { rootDir, aku } = await fixture();
    const rebuilt = await aku.rebuildIndexes();
    assert.ok(rebuilt.generation_id.startsWith('idx_'));

    const meta = JSON.parse(await fs.readFile(path.join(rootDir, '.aku/index-meta.json'), 'utf8'));
    assert.equal(meta.record_counts.ku, 1);
    assert.equal(meta.record_counts.document, 1);
    assert.equal(meta.record_counts.result, 1);
    assert.ok(meta.files['search-index.jsonl'].sha256);
    assert.ok(meta.source.build_options_hash);

    const stats = JSON.parse(await fs.readFile(path.join(rootDir, '.aku/search-stats.json'), 'utf8'));
    assert.equal(stats.record_count, meta.record_counts.search);
    assert.ok(stats.document_frequency.bm25f >= 1);
    assert.ok(aku.searchIndex.postings.has('bm25f'));
});

test('KU updates rebuild aggregate indexes and refresh warm search state', async () => {
    const { rootDir, aku, ku } = await fixture();
    const metaPath = path.join(rootDir, '.aku/index-meta.json');
    const before = JSON.parse(await fs.readFile(metaPath, 'utf8'));

    await aku.updateKUState(ku.ku_id, {
        summary: 'Freshly indexed update token',
        keywords: ['fresh-index-token'],
    });
    const afterUpdate = JSON.parse(await fs.readFile(metaPath, 'utf8'));
    assert.notEqual(afterUpdate.generation_id, before.generation_id);

    const updatedSearch = await aku.search('fresh-index-token', { kuId: ku.ku_id, recordType: 'ku' });
    assert.equal(updatedSearch.results[0].ku_id, ku.ku_id);
    assert.equal(updatedSearch.results[0].summary, 'Freshly indexed update token');

    await aku.setKUStatus(ku.ku_id, 'discarded', 'covered by update indexing test');
    const afterDiscard = JSON.parse(await fs.readFile(metaPath, 'utf8'));
    assert.notEqual(afterDiscard.generation_id, afterUpdate.generation_id);

    const normalSearch = await aku.search('fresh-index-token', { kuId: ku.ku_id });
    assert.equal(normalSearch.results.length, 0);
    const auditSearch = await aku.search('fresh-index-token', { kuId: ku.ku_id, includeDiscarded: true });
    assert.ok(auditSearch.results.length >= 1);
});
