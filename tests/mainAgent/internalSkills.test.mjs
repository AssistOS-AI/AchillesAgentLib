import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { MainAgent } from '../../MainAgent/index.mjs';
import { discoverSkills, discoverSkillsFromRoot } from '../../MainAgent/services/discoverSkills.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, '../..');
const internalSkillsDir = path.join(packageRoot, 'skills');

describe('Internal Skills Discovery', () => {
    describe('discoverSkillsFromRoot', () => {
        it('discovers all skills from the internal skills directory', () => {
            const skills = discoverSkillsFromRoot(internalSkillsDir);
            assert.ok(skills.length > 0, 'Should discover internal skills');
            assert.ok(skills.every(s => s.name.endsWith('-cskill')), 'All internal skills should be cskill type');
        });

        it('returns empty array when directory does not exist', () => {
            const skills = discoverSkillsFromRoot('/nonexistent/path/skills');
            assert.deepStrictEqual(skills, []);
        });

        it('returns empty array when path is not a directory', () => {
            const skills = discoverSkillsFromRoot('/etc/passwd');
            assert.deepStrictEqual(skills, []);
        });

        it('returns empty array when path is null', () => {
            const skills = discoverSkillsFromRoot(null);
            assert.deepStrictEqual(skills, []);
        });

        it('discovers skills in immediate subdirectories', () => {
            const skills = discoverSkillsFromRoot(internalSkillsDir);
            const names = skills.map(s => s.shortName);
            assert.ok(names.includes('mirror-code-generator'));
            assert.ok(names.includes('bash'));
        });

        it('creates correct skill record structure', () => {
            const skills = discoverSkillsFromRoot(internalSkillsDir);
            const skill = skills.find(s => s.shortName === 'mirror-code-generator');
            assert.ok(skill);
            assert.ok(skill.name.endsWith('-cskill'));
            assert.strictEqual(skill.type, 'cskill');
            assert.ok(skill.filePath.endsWith('cskill.md'));
            assert.ok(fs.existsSync(skill.skillDir));
            assert.strictEqual(skill.descriptor, null);
            assert.strictEqual(skill.preparedConfig, null);
        });
    });

    describe('MainAgent internal skills registration', () => {
        let agent;

        afterEach(() => {
            if (agent) {
                agent.shutdown();
            }
        });

        it('internal skills are always discovered regardless of startDir', () => {
            agent = new MainAgent({
                startDir: '/tmp/nonexistent-dir',
                disableInternalSkills: false,
            });
            const internalSkills = agent.getSkills().filter(s => s.isInternal);
            assert.ok(internalSkills.length > 0, 'Should have internal skills');
        });

        it('internal skills directory is resolved relative to MainAgent.mjs', () => {
            agent = new MainAgent({
                startDir: '/tmp/nonexistent-dir',
                disableInternalSkills: false,
            });
            const internalSkills = agent.getSkills().filter(s => s.isInternal);
            for (const skill of internalSkills) {
                assert.ok(
                    skill.skillDir.startsWith(packageRoot),
                    `Skill ${skill.name} should be from package root, got ${skill.skillDir}`
                );
            }
        });

        it('internal skills are registered before user skills', () => {
            const tempDir = fs.mkdtempSync('/tmp/mainagent-test-');
            const skillsDir = path.join(tempDir, 'skills');
            const testSkillDir = path.join(skillsDir, 'test-user-skill');
            fs.mkdirSync(testSkillDir, { recursive: true });
            fs.writeFileSync(path.join(testSkillDir, 'cskill.md'), '# Test User Skill\n\nTest skill.\n');

            try {
                agent = new MainAgent({
                    startDir: tempDir,
                    disableInternalSkills: false,
                });
                const skills = agent.getSkills();
                const internalSkills = skills.filter(s => s.isInternal);
                const userSkills = skills.filter(s => !s.isInternal);

                assert.ok(internalSkills.length > 0, 'Should have internal skills');
                assert.ok(userSkills.length > 0, 'Should have user skills');
            } finally {
                fs.rmSync(tempDir, { recursive: true, force: true });
            }
        });

        it('internal skills have isInternal = true', () => {
            agent = new MainAgent({
                startDir: '/tmp/nonexistent-dir',
                disableInternalSkills: false,
            });
            const internalSkills = agent.getSkills().filter(s => s.isInternal);
            assert.ok(internalSkills.length > 0);
            assert.ok(internalSkills.every(s => s.isInternal === true));
        });

        it('user skills have isInternal = false', () => {
            const tempDir = fs.mkdtempSync('/tmp/mainagent-test-');
            const skillsDir = path.join(tempDir, 'skills');
            const testSkillDir = path.join(skillsDir, 'test-user-skill');
            fs.mkdirSync(testSkillDir, { recursive: true });
            fs.writeFileSync(path.join(testSkillDir, 'cskill.md'), '# Test User Skill\n\nTest skill.\n');

            try {
                agent = new MainAgent({
                    startDir: tempDir,
                    disableInternalSkills: false,
                });
                const userSkills = agent.getSkills().filter(s => !s.isInternal);
                assert.ok(userSkills.length > 0);
                assert.ok(userSkills.every(s => s.isInternal === false));
            } finally {
                fs.rmSync(tempDir, { recursive: true, force: true });
            }
        });

        it('user skills overwrite internal skills with same canonical name', () => {
            const tempDir = fs.mkdtempSync('/tmp/mainagent-test-');
            const skillsDir = path.join(tempDir, 'skills');

            // Create a user skill with same name as an internal skill
            const internalSkill = discoverSkillsFromRoot(internalSkillsDir)[0];
            const userSkillDir = path.join(skillsDir, internalSkill.shortName);
            fs.mkdirSync(userSkillDir, { recursive: true });
            fs.writeFileSync(path.join(userSkillDir, 'cskill.md'), '# Overridden Skill\n\nUser version.\n');

            try {
                agent = new MainAgent({
                    startDir: tempDir,
                    disableInternalSkills: false,
                });
                const skill = agent.getSkillRecord(internalSkill.shortName);
                assert.ok(skill);
                assert.strictEqual(skill.isInternal, false, 'User skill should override internal');
                assert.strictEqual(skill.skillDir, userSkillDir);
            } finally {
                fs.rmSync(tempDir, { recursive: true, force: true });
            }
        });

        it('internal skills count matches expected number', () => {
            const expectedSkills = ['bash', 'edit', 'glob', 'grep', 'mirror-code-generator', 'read', 'webfetch', 'write'];
            agent = new MainAgent({
                startDir: '/tmp/nonexistent-dir',
                disableInternalSkills: false,
            });
            const internalSkills = agent.getSkills().filter(s => s.isInternal);
            const internalNames = internalSkills.map(s => s.shortName).sort();

            assert.strictEqual(internalSkills.length, expectedSkills.length);
            assert.deepStrictEqual(internalNames, expectedSkills.sort());
        });

        it('internal skills are accessible by short name and canonical name', () => {
            agent = new MainAgent({
                startDir: '/tmp/nonexistent-dir',
                disableInternalSkills: false,
            });

            const byShortName = agent.getSkillRecord('mirror-code-generator');
            const byCanonical = agent.getSkillRecord('mirror-code-generator-cskill');

            assert.ok(byShortName);
            assert.ok(byCanonical);
            assert.strictEqual(byShortName, byCanonical);
            assert.strictEqual(byShortName.isInternal, true);
        });

        it('does not register internal skills when disableInternalSkills is true', () => {
            agent = new MainAgent({
                startDir: '/tmp/nonexistent-dir',
                disableInternalSkills: true,
            });

            const internalSkills = agent.getSkills().filter(s => s.isInternal);
            assert.strictEqual(internalSkills.length, 0);
            assert.strictEqual(agent.getSkillRecord('mirror-code-generator'), null);
        });

        it('disables internal skills by default', () => {
            agent = new MainAgent({ startDir: '/tmp/nonexistent-dir' });

            const internalSkills = agent.getSkills().filter(s => s.isInternal);
            assert.strictEqual(internalSkills.length, 0);
            assert.strictEqual(agent.getSkillRecord('mirror-code-generator'), null);
        });

        it('still discovers user skills when disableInternalSkills is true', () => {
            const tempDir = fs.mkdtempSync('/tmp/mainagent-test-');
            const skillsDir = path.join(tempDir, 'skills');
            const testSkillDir = path.join(skillsDir, 'test-user-skill');
            fs.mkdirSync(testSkillDir, { recursive: true });
            fs.writeFileSync(path.join(testSkillDir, 'cskill.md'), '# Test User Skill\n\nTest skill.\n');

            try {
                agent = new MainAgent({
                    startDir: tempDir,
                    disableInternalSkills: true,
                });

                const skills = agent.getSkills();
                const internalSkills = skills.filter(s => s.isInternal);
                const userSkills = skills.filter(s => !s.isInternal);

                assert.strictEqual(internalSkills.length, 0);
                assert.ok(userSkills.length > 0, 'Should have user skills');
                assert.ok(userSkills.every(s => s.isInternal === false));
            } finally {
                fs.rmSync(tempDir, { recursive: true, force: true });
            }
        });
    });
});
