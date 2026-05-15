import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseSkillDocument } from '../../utils/skillDocumentParser.mjs';

test('parseSkillDocument preserves Help as a normalized descriptor section', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'skill-document-parser-'));
    const descriptorPath = join(tempDir, 'cskill.md');
    await writeFile(descriptorPath, [
        '# Demo Skill',
        '',
        '## Description',
        'Demo description.',
        '',
        '## Help',
        'Call this skill with a short user request.',
        'Example: /exec demo-skill summarize this text',
    ].join('\n'));

    const descriptor = parseSkillDocument(descriptorPath);

    assert.equal(descriptor.name, 'Demo Skill');
    assert.equal(descriptor.sections.help, [
        'Call this skill with a short user request.',
        'Example: /exec demo-skill summarize this text',
    ].join('\n'));
});
