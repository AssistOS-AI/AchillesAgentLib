/**
 * Test script for LLMClient.mjs header handling.
 *
 * Regression guard for the removal of the legacy `X-Soul-Agent` identity header:
 * after the change, the headers handed to a provider's `callLLM` must NOT contain
 * `X-Soul-Agent` (or any other legacy identity header) even when `AGENT_NAME` is set.
 * Identity now comes only from the signed API key carried in `Authorization`.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { callLLMWithModel } from '../utils/LLMClient.mjs';
import { registerProvider, resetProviders } from '../utils/LLMProviders/providers/providerRegistry.mjs';

const LEGACY_HEADERS = ['X-Soul-Agent', 'x-soul-agent', 'x-soul-id', 'x-agent-name'];

describe('LLMClient header handling', () => {
    const originalAgentName = process.env.AGENT_NAME;
    let captured;
    let capturedHistory;

    function registerCapturingStub() {
        registerProvider({
            key: 'stub',
            handler: {
                async callLLM(history, options) {
                    capturedHistory = history;
                    captured = options;
                    return { content: 'ok', usage: {} };
                },
            },
        });
    }

    beforeEach(() => {
        captured = null;
        capturedHistory = null;
        resetProviders();
        registerCapturingStub();
        // Prove the header is no longer injected even when AGENT_NAME is present.
        process.env.AGENT_NAME = 'unit-test-agent';
    });

    afterEach(() => {
        resetProviders();
        if (originalAgentName === undefined) {
            delete process.env.AGENT_NAME;
        } else {
            process.env.AGENT_NAME = originalAgentName;
        }
    });

    it('does not inject any legacy identity header when AGENT_NAME is set', async () => {
        await callLLMWithModel('stub/test-model', [], 'hello', {
            providerKey: 'stub',
            baseURL: 'https://stub.example.com/v1/chat/completions',
            apiKey: 'sk-signed-subject-key',
        });

        assert.ok(captured, 'expected the stub provider to be invoked');
        assert.ok(captured.headers && typeof captured.headers === 'object', 'expected headers object passed to provider');
        for (const header of LEGACY_HEADERS) {
            assert.strictEqual(
                Object.prototype.hasOwnProperty.call(captured.headers, header),
                false,
                `provider headers must not contain legacy identity header "${header}"`,
            );
        }
    });

    it('forwards caller-supplied headers untouched (no legacy header added)', async () => {
        await callLLMWithModel('stub/test-model', [], 'hello', {
            providerKey: 'stub',
            baseURL: 'https://stub.example.com/v1/chat/completions',
            apiKey: 'sk-signed-subject-key',
            headers: { 'X-Custom': 'preserved' },
        });

        assert.ok(captured, 'expected the stub provider to be invoked');
        assert.strictEqual(captured.headers['X-Custom'], 'preserved');
        for (const header of LEGACY_HEADERS) {
            assert.strictEqual(
                Object.prototype.hasOwnProperty.call(captured.headers, header),
                false,
                `provider headers must not contain legacy identity header "${header}"`,
            );
        }
    });

    it('appends the current prompt as the final user-role message', async () => {
        await callLLMWithModel(
            'stub/test-model',
            [
                { role: 'system', message: 'rules' },
                { role: 'user', message: 'earlier request' },
                { role: 'assistant', message: 'earlier answer' },
            ],
            'current request',
            {
                providerKey: 'stub',
                baseURL: 'https://stub.example.com/v1/chat/completions',
                apiKey: 'sk-signed-subject-key',
            },
        );

        assert.deepStrictEqual(capturedHistory, [
            { role: 'system', message: 'rules' },
            { role: 'user', message: 'earlier request' },
            { role: 'assistant', message: 'earlier answer' },
            { role: 'user', message: 'current request' },
        ]);
    });
});

console.log('Running LLMClient header tests...');
