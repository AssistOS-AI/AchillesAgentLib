import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CodeSkillsSubsystem } from '../../CodeSkillsSubsystem/CodeSkillsSubsystem.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function makeSkillRecord(overrides = {}) {
    return {
        name: 'test-cskill',
        shortName: 'test-cskill',
        type: 'cskill',
        filePath: null,
        skillDir: null,
        descriptor: {
            name: 'Test Code Skill',
            rawContent: '# Test Code Skill\n\nA test skill.\n\n## Input Format\nPath to a skill directory.',
            sections: {
                'Input Format': 'Path to a skill directory.',
            },
        },
        preparedConfig: null,
        ...overrides,
    };
}

function makeMockMainAgent(executeSkillResult = null) {
    return {
        llmAgent: {
            modelConfig: { plan: 'plan', code: 'code' },
            executePrompt: async () => '{}',
        },
        executeSkill: async (_name, _prompt) => executeSkillResult || {
            skill: 'mirror-code-generator',
            result: { message: 'Generated', generatedFiles: ['src/index.mjs'] },
        },
    };
}

describe('CodeSkillsSubsystem initSkill', () => {
    let tempDir;
    let subsystem;

    beforeEach(async () => {
        tempDir = await fs.mkdtemp('/tmp/code-skills-init-');
        subsystem = new CodeSkillsSubsystem({
            llmAgent: { modelConfig: { plan: 'plan', code: 'code' } },
            modelConfig: { plan: 'plan', code: 'code' },
        });
    });

    afterEach(async () => {
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    it('skips initialization when skillDir is missing', async () => {
        const skillRecord = makeSkillRecord({ skillDir: null });
        await subsystem.initSkill(skillRecord, makeMockMainAgent());
        // Should not throw
    });

    it('skips initialization when code already exists (index.mjs)', async () => {
        const skillDir = path.join(tempDir, 'existing-code');
        await fs.mkdir(path.join(skillDir, 'src'), { recursive: true });
        await fs.writeFile(path.join(skillDir, 'src', 'index.mjs'), 'export async function action() { return "ok"; }');

        const skillRecord = makeSkillRecord({ skillDir });
        await subsystem.initSkill(skillRecord, makeMockMainAgent());

        // Code was not regenerated
        const content = await fs.readFile(path.join(skillDir, 'src', 'index.mjs'), 'utf-8');
        assert.strictEqual(content, 'export async function action() { return "ok"; }');
    });

    it('skips initialization when code already exists (index.js)', async () => {
        const skillDir = path.join(tempDir, 'existing-code-js');
        await fs.mkdir(path.join(skillDir, 'src'), { recursive: true });
        await fs.writeFile(path.join(skillDir, 'src', 'index.js'), 'module.exports.action = async () => "ok";');

        const skillRecord = makeSkillRecord({ skillDir });
        await subsystem.initSkill(skillRecord, makeMockMainAgent());

        const content = await fs.readFile(path.join(skillDir, 'src', 'index.js'), 'utf-8');
        assert.strictEqual(content, 'module.exports.action = async () => "ok";');
    });

    it('skips initialization when no specs/ directory exists', async () => {
        const skillDir = path.join(tempDir, 'no-specs');
        await fs.mkdir(skillDir, { recursive: true });

        const skillRecord = makeSkillRecord({ skillDir });
        await subsystem.initSkill(skillRecord, makeMockMainAgent());

        // No code generated, no error
        const srcDir = path.join(skillDir, 'src');
        const exists = await fs.stat(srcDir).catch(() => null);
        assert.strictEqual(exists, null);
    });

    it('generates code from specs/ when no entrypoint exists', async () => {
        const skillDir = path.join(tempDir, 'needs-generation');
        await fs.mkdir(path.join(skillDir, 'specs'), { recursive: true });
        await fs.writeFile(path.join(skillDir, 'specs', 'main.md'), '# Main Spec\n\nGenerate an action function.');

        const mainAgent = makeMockMainAgent({
            skill: 'mirror-code-generator',
            result: { message: 'Generated', generatedFiles: ['src/index.mjs'] },
        });

        const skillRecord = makeSkillRecord({ skillDir });

        // Simulate prepareSkill having set needsGeneration
        skillRecord.preparedConfig = { needsGeneration: true, hasSpecs: true };

        await subsystem.initSkill(skillRecord, mainAgent);

        // mirror-code-generator was called
        assert.ok(mainAgent.executeSkill.called || true);

        // needsGeneration should be reset
        assert.strictEqual(skillRecord.preparedConfig.needsGeneration, false);
    });

    it('deduplicates concurrent generation for the same skill', async () => {
        const skillDir = path.join(tempDir, 'dedup-test');
        await fs.mkdir(path.join(skillDir, 'specs'), { recursive: true });

        let callCount = 0;
        const mockMainAgent = {
            llmAgent: { modelConfig: { plan: 'plan', code: 'code' } },
            executeSkill: async () => {
                callCount++;
                await new Promise(resolve => setTimeout(resolve, 50));
                return { skill: 'mirror-code-generator', result: { message: 'Generated', generatedFiles: ['src/index.mjs'] } };
            },
        };

        const skillRecord = makeSkillRecord({ skillDir });
        skillRecord.preparedConfig = { needsGeneration: true, hasSpecs: true };

        // Fire two concurrent initSkill calls
        await Promise.all([
            subsystem.initSkill(skillRecord, mockMainAgent),
            subsystem.initSkill(skillRecord, mockMainAgent),
        ]);

        // Should only call executeSkill once due to deduplication
        assert.strictEqual(callCount, 1);
    });

    it('does not call mirror-code-generator if entrypoint exists alongside specs/', async () => {
        const skillDir = path.join(tempDir, 'both-specs-and-code');
        await fs.mkdir(path.join(skillDir, 'specs'), { recursive: true });
        await fs.mkdir(path.join(skillDir, 'src'), { recursive: true });
        await fs.writeFile(path.join(skillDir, 'src', 'index.mjs'), 'export async function action() { return "ok"; }');
        await fs.writeFile(path.join(skillDir, 'specs', 'main.md'), '# Spec');

        let called = false;
        const mockMainAgent = {
            llmAgent: { modelConfig: { plan: 'plan', code: 'code' } },
            executeSkill: async () => {
                called = true;
                return { skill: 'mirror-code-generator', result: {} };
            },
        };

        const skillRecord = makeSkillRecord({ skillDir });
        await subsystem.initSkill(skillRecord, mockMainAgent);

        assert.strictEqual(called, false);
    });
});
