import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

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
});
