import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSuiteContext } from '../testUtil/index.mjs';

const suite = createSuiteContext('FS-002', { timeoutMs: 20_000 });

test('[FS-002] specification entry exists', { timeout: suite.timeoutMs }, () => {
    const docName = suite.suiteName.startsWith('NFS') ? 'NFS.md' : 'FS.md';
    const docPath = path.join(suite.workspaceRoot, '.specs', docName);
    const content = fs.readFileSync(docPath, 'utf8');
    assert.ok(content.includes('FS-002'), 'Specification entry must be present in the corresponding document.');
});

test('[FS-002] temporary workspace prepared', { timeout: suite.timeoutMs }, () => {
    const marker = path.join(suite.tempDir, 'context.json');
    fs.writeFileSync(marker, JSON.stringify({ suite: suite.suiteName, timestamp: Date.now() }, null, 2));
    assert.ok(fs.existsSync(marker), 'Temporary execution folder must contain the context marker.');
});
