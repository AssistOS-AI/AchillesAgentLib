import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { MainAgent } from '../../MainAgent/index.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('MainAgent executeSkill', () => {
    let tempDir;

    beforeEach(() => {
        tempDir = fs.mkdtempSync('/tmp/mainagent-executeskill-');
    });

    afterEach(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('throws when skill not found', async () => {
        const agent = new MainAgent({ startDir: tempDir });
        await assert.rejects(
            async () => agent.executeSkill('nonexistent-skill', 'test prompt'),
            { message: /Skill "nonexistent-skill" not found/ }
        );
    });

    it('throws when subsystem does not support execution', async () => {
        const agent = new MainAgent({ startDir: tempDir });
        const skills = agent.getSkills();
        if (skills.length === 0) {
            return;
        }

        const skill = skills[0];
        const originalType = skill.type;

        skill.type = 'unknown-type';
        try {
            await assert.rejects(
                async () => agent.executeSkill(skill.name, 'test prompt'),
                { message: /unknown-type/ }
            );
        } finally {
            skill.type = originalType;
        }
    });

    it('returns skill result for mirror-code-generator', async () => {
        const agent = new MainAgent({ startDir: tempDir });
        const skill = agent.getSkillRecord('mirror-code-generator');
        if (!skill) {
            return;
        }

        const result = await agent.executeSkill('mirror-code-generator', tempDir);

        assert.ok(result);
        assert.strictEqual(result.skill, skill.name);
        assert.ok('result' in result);
    });

    it('resolves skill by short name', async () => {
        const agent = new MainAgent({ startDir: tempDir });
        const skill = agent.getSkillRecord('mirror-code-generator');
        if (!skill) {
            return;
        }

        const result = await agent.executeSkill('mirror-code-generator', tempDir);

        assert.ok(result);
        assert.strictEqual(result.skill, skill.name);
    });

    it('passes options through to subsystem', async () => {
        const agent = new MainAgent({ startDir: tempDir });
        const customOptions = { context: { sessionId: 'test-session' } };
        const result = await agent.executeSkill('mirror-code-generator', tempDir, customOptions);

        assert.ok(result);
        assert.ok(result.skill.includes('mirror-code-generator'));
    });

    it('executeSkill uses modelConfig from llmAgent', async () => {
        const customConfig = {
            thinking: 'custom-thinking-model',
            fast: 'custom-fast-model',
        };
        const agent = new MainAgent({
            startDir: tempDir,
            modelConfig: customConfig,
        });

        assert.deepStrictEqual(agent.llmAgent.modelConfig, customConfig);
        assert.strictEqual(agent.llmAgent.modelConfig.thinking, 'custom-thinking-model');
    });
});
