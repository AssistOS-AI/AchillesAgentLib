import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { MainAgent } from '../../MainAgent/index.mjs';

describe('MainAgent executePrompt', () => {
    it('creates one session and reuses it on subsequent prompts', async () => {
        const agent = new MainAgent({ startDir: '/tmp/nonexistent-dir' });

        const calls = [];
        let currentResult = 'initial';
        const session = {
            status: 'running',
            async newPrompt(message) {
                calls.push({ type: 'newPrompt', message });
                currentResult = `next:${message}`;
            },
            getLastResult() {
                return currentResult;
            },
        };

        agent.llmAgent.startLoopAgentSession = async (_tools, message) => {
            calls.push({ type: 'start', message });
            currentResult = `start:${message}`;
            return session;
        };

        const first = await agent.executePrompt('hello');
        const second = await agent.executePrompt('again');

        assert.deepStrictEqual(calls, [
            { type: 'start', message: 'hello' },
            { type: 'newPrompt', message: 'again' },
        ]);
        assert.deepStrictEqual(first, { result: 'start:hello', status: 'running' });
        assert.deepStrictEqual(second, { result: 'next:again', status: 'running' });

        agent.shutdown();
    });

    it('forwards AbortSignal to session newPrompt on reused sessions', async () => {
        const agent = new MainAgent({ startDir: '/tmp/nonexistent-dir' });

        const capturedSignals = [];
        const session = {
            status: 'running',
            async newPrompt(_message, options = {}) {
                capturedSignals.push(options.signal || null);
            },
            getLastResult() {
                return 'ok';
            },
        };

        agent.llmAgent.startLoopAgentSession = async () => session;

        await agent.executePrompt('first');
        const controller = new AbortController();
        await agent.executePrompt('second', { signal: controller.signal });

        assert.equal(capturedSignals.length, 1);
        assert.equal(capturedSignals[0], controller.signal);

        agent.shutdown();
    });

    it('cancelCurrentSession forwards reason to session cancel', async () => {
        const agent = new MainAgent({ startDir: '/tmp/nonexistent-dir' });

        let cancelReason = null;
        const session = {
            status: 'running',
            async newPrompt() {},
            getLastResult() { return 'ok'; },
            cancel(reason) { cancelReason = reason; },
        };

        agent.llmAgent.startLoopAgentSession = async () => session;
        await agent.executePrompt('hello');

        agent.cancelCurrentSession('esc');

        assert.equal(cancelReason, 'esc');
        agent.shutdown();
    });

    it('does not expose skills owned by orchestrator allowlists as top-level tools', async () => {
        const tempDir = fs.mkdtempSync('/tmp/mainagent-orchestrated-tools-');
        try {
            const skillsDir = path.join(tempDir, 'skills');
            fs.mkdirSync(path.join(skillsDir, 'admin-flow'), { recursive: true });
            fs.mkdirSync(path.join(skillsDir, 'load-admin-context'), { recursive: true });
            fs.mkdirSync(path.join(skillsDir, 'update-lead'), { recursive: true });
            fs.mkdirSync(path.join(skillsDir, 'public-report'), { recursive: true });

            fs.writeFileSync(path.join(skillsDir, 'admin-flow', 'oskill.md'), `# admin-flow

## Description
Admin orchestration entrypoint.

## Allowed Skills
- update-lead

## Allowed Preparation Skills
- load-admin-context
`);
            fs.writeFileSync(path.join(skillsDir, 'load-admin-context', 'cskill.md'), `# load-admin-context

## Description
Load admin context.
`);
            fs.writeFileSync(path.join(skillsDir, 'update-lead', 'cskill.md'), `# update-lead

## Description
Update a lead.
`);
            fs.writeFileSync(path.join(skillsDir, 'public-report', 'cskill.md'), `# public-report

## Description
Public report.
`);

            const agent = new MainAgent({ startDir: tempDir });
            let exposedToolNames = [];
            agent.llmAgent.startLoopAgentSession = async (tools) => {
                exposedToolNames = Object.keys(tools).sort();
                return {
                    status: 'done',
                    getLastResult() {
                        return 'ok';
                    },
                };
            };

            await agent.executePrompt('admin request');

            assert.deepEqual(exposedToolNames, ['admin-flow', 'public-report']);
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it('uses only the Description section for top-level orchestrator tool descriptions', async () => {
        const tempDir = fs.mkdtempSync('/tmp/mainagent-orchestrator-description-');
        try {
            const skillsDir = path.join(tempDir, 'skills');
            fs.mkdirSync(path.join(skillsDir, 'admin-flow'), { recursive: true });
            fs.mkdirSync(path.join(skillsDir, 'load-admin-context'), { recursive: true });
            fs.mkdirSync(path.join(skillsDir, 'manage-owner-info'), { recursive: true });

            fs.writeFileSync(path.join(skillsDir, 'admin-flow', 'oskill.md'), `# admin-flow

## Description
Admin orchestration entrypoint for webAdmin requests.

## Preparation
- Execute load-admin-context before planning.

## Allowed Preparation Skills
- load-admin-context

## Instructions
- Use manage-owner-info when owner details must change.

## Allowed Skills
- manage-owner-info
`);
            fs.writeFileSync(path.join(skillsDir, 'load-admin-context', 'cskill.md'), `# load-admin-context

## Description
Load admin context.
`);
            fs.writeFileSync(path.join(skillsDir, 'manage-owner-info', 'cskill.md'), `# manage-owner-info

## Description
Manage owner info.
`);

            const agent = new MainAgent({ startDir: tempDir });
            const description = agent._buildToolsForSession()['admin-flow'].description;

            assert.equal(description, 'Admin orchestration entrypoint for webAdmin requests.');
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it('passes parent loop session snapshot to skill execution options', async () => {
        const agent = new MainAgent({ startDir: '/tmp/nonexistent-dir' });
        agent._skills.set('admin-flow-orchestrator', {
            name: 'admin-flow-orchestrator',
            shortName: 'admin-flow',
            type: 'orchestrator',
            descriptor: { rawContent: 'Admin flow' },
        });

        let capturedOptions = null;
        agent.executeSkill = async (_skillName, _prompt, options = {}) => {
            capturedOptions = options;
            return { result: 'ok' };
        };

        const tools = agent._buildToolsForSession();
        await tools['admin-flow'].handler(null, 'continue', {
            session: {
                getConversationSnapshot: () => ({
                    type: 'loop',
                    history: [{ type: 'user', prompt: 'previous' }],
                    toolResults: [],
                }),
            },
        });

        assert.deepEqual(capturedOptions.context.parentSession.history, [
            { type: 'user', prompt: 'previous' },
        ]);
    });
});
