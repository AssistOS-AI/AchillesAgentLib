import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AgenticKnowledgeUnits } from '../../AgenticKnowledgeUnits/index.mjs';

async function makeFixture() {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aku-links-'));
    await fs.mkdir(path.join(rootDir, 'experiments', 'run-17', 'exp-a'), { recursive: true });
    await fs.mkdir(path.join(rootDir, 'experiments', 'run-17', 'exp-b'), { recursive: true });
    await fs.writeFile(path.join(rootDir, 'experiments', 'run-17', 'exp-b', 'notes.md'), 'token-aware parser notes');
    const aku = new AgenticKnowledgeUnits({ rootDir, actor: 'test', contextBudgetChars: 5000 });
    await aku.initAKU();
    const folder = await aku.initKU({
        ku_name: 'Folder: experiments/run-17',
        ku_type: 'workstream',
        summary: 'Workspace for parser experiments.',
        tags: ['folder-scope', 'parser'],
        keywords: ['experiments/run-17'],
    });
    const expA = await aku.initKU({
        ku_name: 'Experiment A: baseline parser',
        ku_type: 'experiment',
        parent_ku_id: folder.ku_id,
        summary: 'Baseline parser experiment.',
        tags: ['experiment', 'parser'],
    });
    const expB = await aku.initKU({
        ku_name: 'Experiment B: token-aware parser',
        ku_type: 'experiment',
        parent_ku_id: folder.ku_id,
        summary: 'Token-aware chunking reduced malformed splits.',
        tags: ['experiment', 'parser'],
        keywords: ['token-aware chunking'],
        reusable_findings: ['Token-aware chunking is the current best candidate.'],
    });
    return { rootDir, aku, folder, expA, expB };
}

test('KU links and folder scopes are indexed, listed, and discardable', async () => {
    const { aku, folder, expA } = await makeFixture();

    const scope = await aku.registerFolderScope(folder.ku_id, {
        path: 'experiments/run-17',
        summary: 'Folder workstream scope for parser experiments.',
        tags: ['run-17'],
    });
    assert.equal(scope.file_type, 'folder_scope');
    assert.equal(scope.path, 'experiments/run-17');

    const link = await aku.linkKU(folder.ku_id, expA.ku_id, {
        relation: 'contains',
        summary: 'Folder workstream contains experiment A.',
    });
    assert.equal(link.source_ku_id, folder.ku_id);
    assert.equal(link.target_ku_id, expA.ku_id);
    assert.equal(link.relation, 'contains');

    const links = await aku.listKULinks(folder.ku_id);
    assert.deepEqual(links.map(item => item.link_id), [link.link_id]);
    const scopes = await aku.listFolderScopes({ kuId: folder.ku_id });
    assert.deepEqual(scopes.map(item => item.path), ['experiments/run-17']);

    const search = await aku.search('contains experiment A', { recordType: 'link', explain: true });
    assert.equal(search.results[0].record_type, 'link');
    assert.equal(search.results[0].target_ku_id, expA.ku_id);

    await aku.unlinkKU(folder.ku_id, link.link_id, 'no longer active');
    assert.equal((await aku.listKULinks(folder.ku_id)).length, 0);
    assert.equal((await aku.listKULinks(folder.ku_id, { includeDiscarded: true })).length, 1);
});

test('scoped context prefers active and explicit KUs without loading unrelated linked experiments by default', async () => {
    const { aku, folder, expA, expB } = await makeFixture();
    await aku.registerFolderScope(folder.ku_id, {
        path: 'experiments/run-17',
        summary: 'Folder workstream scope for parser experiments.',
    });
    await aku.linkKU(folder.ku_id, expA.ku_id, {
        relation: 'contains',
        summary: 'Folder contains baseline experiment A.',
    });
    await aku.linkKU(folder.ku_id, expB.ku_id, {
        relation: 'contains',
        summary: 'Folder contains token-aware experiment B.',
    });
    await aku.registerFile(expB.ku_id, {
        path: 'experiments/run-17/exp-b/notes.md',
        summary: 'Token-aware parser notes.',
        tags: ['token-aware'],
    });
    await aku.recordResult(expB.ku_id, {
        title: 'Malformed split rate',
        summary: 'Token-aware parser reduced malformed splits from 14 percent to 3 percent.',
        status: 'accepted',
    });

    const pack = await aku.buildScopedContextPack('compare token-aware parser', {
        activeKuId: folder.ku_id,
        explicitKuIds: [expB.ku_id],
        folderPath: 'experiments/run-17',
        budgetChars: 4500,
        maxResultsPerKU: 4,
        linkDepth: 1,
        explain: true,
    });

    const kuIds = new Set(pack.results.map(item => item.ku_id));
    assert.equal(pack.algorithm, 'scoped_aku_context_pack');
    assert.equal(pack.scope.active_ku_id, folder.ku_id);
    assert.ok(kuIds.has(folder.ku_id), 'active folder KU is included');
    assert.ok(kuIds.has(expB.ku_id), 'explicit experiment KU is included');
    assert.equal(kuIds.has(expA.ku_id), false, 'unmentioned linked experiment is not loaded by default');
    assert.ok(pack.results.some(item => item.scope?.includes('ku_link')), 'link records can appear as lightweight relationship hints');

    const withSummaries = await aku.buildScopedContextPack('compare token-aware parser', {
        activeKuId: folder.ku_id,
        explicitKuIds: [expB.ku_id],
        budgetChars: 4500,
        maxResultsPerKU: 4,
        linkDepth: 1,
        includeLinked: 'summaries',
        explain: true,
    });
    assert.ok(new Set(withSummaries.results.map(item => item.ku_id)).has(expA.ku_id));
});
