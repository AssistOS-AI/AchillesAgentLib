import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AgenticKnowledgeUnits } from '../../AgenticKnowledgeUnits/index.mjs';

test('ContextPack applies budget, MMR, quotas, detail levels, and explanations', async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aku-context-'));
    const aku = new AgenticKnowledgeUnits({ rootDir, actor: 'test', contextBudgetChars: 1200 });
    await aku.initAKU();
    const first = await aku.initKU({
        ku_name: 'Search Architecture',
        tags: ['search'],
        keywords: ['Context Pack'],
        summary: 'BM25F search and MMR packing',
        state: 'State material only appears at L2.',
    });
    const second = await aku.initKU({
        ku_name: 'Storage Architecture',
        tags: ['storage'],
        keywords: ['Context Pack'],
        summary: 'Atomic writes and repairable JSONL indexes',
        state: 'Different KU state.',
    });
    await aku.recordDocument(first.ku_id, { title: 'Search Detail', summary: 'BM25F search Context Pack details', tags: ['search'] });
    await aku.recordDocument(first.ku_id, { title: 'Search Detail Duplicate', summary: 'BM25F search Context Pack details', tags: ['search'] });
    await aku.recordResult(second.ku_id, { title: 'Storage Result', summary: 'Context Pack stores repair details', tags: ['storage'] });

    const pack = await aku.buildContextPack('Context Pack search storage', {
        budgetChars: 900,
        maxResultsPerKU: 1,
        quotas: { document: 1, ku: 2, result: 1 },
        includeState: true,
        explain: true,
    });

    assert.equal(pack.algorithm, 'bm25f_with_bounded_exact_boosts_mmr');
    assert.equal(pack.used_chars, JSON.stringify(pack).length);
    assert.ok(pack.used_chars <= pack.budget_chars);
    assert.ok(pack.results.length >= 1);
    assert.ok(pack.omitted.count >= 1);
    assert.ok(pack.results.every(item => item.why_included));
    assert.ok(pack.results.filter(item => item.ku_id === first.ku_id).length <= 1);
    const l2 = pack.results.find(item => item.record_type === 'ku');
    assert.equal(l2?.loaded_level, 'L2');
    assert.equal(l2?.why_included.loaded_level, 'L2');
    assert.ok(l2?.state.length > 0);
});

test('ContextPack reports actual payload size when the budget cannot fit any result', async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aku-context-small-'));
    const aku = new AgenticKnowledgeUnits({ rootDir, actor: 'test' });
    await aku.initAKU();
    const ku = await aku.initKU({
        ku_name: 'Tiny Budget',
        summary: 'This candidate cannot fit inside an impossibly small budget.',
    });
    await aku.recordDocument(ku.ku_id, { title: 'Tiny Budget Document', summary: 'payload accounting' });

    const pack = await aku.buildContextPack('Tiny Budget Document', { budgetChars: 10, explain: true });
    assert.equal(pack.results.length, 0);
    assert.equal(pack.used_chars, JSON.stringify(pack).length);
    assert.ok(pack.used_chars > pack.budget_chars);
});
