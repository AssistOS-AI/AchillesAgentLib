import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { MainAgent } from '../../MainAgent/index.mjs';

const nextTick = () => new Promise(resolve => setImmediate(resolve));

describe('MainAgent buildSkills', () => {
    it('initializes all skills in parallel and waits for all to complete', async () => {
        const tempDir = fs.mkdtempSync('/tmp/mainagent-initskills-');
        const agent = new MainAgent({
            startDir: tempDir,
            disableInternalSkills: true,
        });

        try {
            const skills = [
                { name: 'alpha-cskill', type: 'cskill' },
                { name: 'beta-cskill', type: 'cskill' },
            ];
            const resolvers = new Map();
            const started = [];

            agent.getSkills = () => skills;
            agent.subsystemFactory.get = () => ({
                buildSkill: async (skillRecord) => new Promise(resolve => {
                    started.push(skillRecord.name);
                    resolvers.set(skillRecord.name, resolve);
                }),
            });

            let settled = false;
            const initPromise = agent.buildSkills().then(() => {
                settled = true;
            });

            await nextTick();
            assert.deepStrictEqual(started.sort(), ['alpha-cskill', 'beta-cskill']);

            resolvers.get('alpha-cskill')();
            await nextTick();
            assert.strictEqual(settled, false, 'Should wait for every buildSkill call to finish');

            resolvers.get('beta-cskill')();
            await initPromise;
            assert.strictEqual(settled, true);
        } finally {
            agent.shutdown();
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });
});
