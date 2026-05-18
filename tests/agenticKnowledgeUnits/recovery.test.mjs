import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AgenticKnowledgeUnits } from '../../AgenticKnowledgeUnits/index.mjs';

async function fixture() {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aku-recovery-'));
    const aku = new AgenticKnowledgeUnits({ rootDir, actor: 'test', staleLockMs: 1 });
    await aku.initAKU();
    const ku = await aku.initKU({ ku_name: 'Recovery KU', summary: 'recoverable index' });
    await aku.recordDocument(ku.ku_id, { title: 'Recovery Document', summary: 'doctor rebuild target' });
    return { rootDir, aku, ku };
}

test('doctor repairs pending markers, corrupt JSONL, missing indexes, stale locks, and hash mismatch', async () => {
    const { rootDir, aku } = await fixture();
    const akuRoot = path.join(rootDir, '.aku');

    await fs.writeFile(path.join(akuRoot, 'pending/txn_leftover.json'), '{}\n');
    let report = await aku.doctor({ autoRepair: true });
    assert.equal(report.ok, true);
    assert.ok(report.issues.some(issue => issue.code === 'AKU_TRANSACTION_PENDING'));

    await fs.writeFile(path.join(akuRoot, 'search-index.jsonl'), '{bad json\n');
    report = await aku.doctor({ autoRepair: true });
    assert.equal(report.ok, true);
    assert.ok(report.issues.some(issue => issue.code === 'AKU_CORRUPT_INDEX'));

    await fs.rm(path.join(akuRoot, 'search-stats.json'));
    report = await aku.doctor({ autoRepair: true });
    assert.equal(report.ok, true);
    assert.ok(report.issues.some(issue => issue.code === 'AKU_REBUILD_REQUIRED'));

    await fs.appendFile(path.join(akuRoot, 'search-index.jsonl'), '\n');
    report = await aku.doctor({ autoRepair: true });
    assert.equal(report.ok, true);
    assert.ok(report.issues.some(issue => issue.message.includes('Checksum mismatch')));

    const lockDir = path.join(akuRoot, 'lock');
    await fs.mkdir(lockDir);
    await fs.writeFile(path.join(lockDir, 'metadata.json'), JSON.stringify({
        refreshed_at: '2000-01-01T00:00:00.000Z',
    }));
    await new Promise(resolve => setTimeout(resolve, 5));
    report = await aku.doctor({ autoRepair: true });
    assert.equal(report.ok, true);
    assert.ok(report.issues.some(issue => issue.code === 'AKU_STALE_LOCK'));
});
