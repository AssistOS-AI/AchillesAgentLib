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
});
