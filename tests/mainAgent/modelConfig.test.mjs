import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { LLMAgent } from '../../LLMAgents/index.mjs';
import { MainAgent } from '../../MainAgent/index.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('LLMAgent modelConfig', () => {
    describe('constructor', () => {
        it('creates default modelConfig from LLMConfig.json when not provided', () => {
            const agent = new LLMAgent();
            assert.ok(agent.modelConfig);
            assert.strictEqual(agent.modelConfig.thinking, 'soul_gateway/plan');
            assert.strictEqual(agent.modelConfig.fast, 'soul_gateway/fast');
            assert.strictEqual(agent.modelConfig.code, 'soul_gateway/code');
            assert.strictEqual(agent.modelConfig.writing, 'soul_gateway/write');
            assert.strictEqual(agent.modelConfig.research, 'soul_gateway/deep');
            assert.strictEqual(agent.modelConfig['long-context'], 'soul_gateway/deep');
            assert.strictEqual(agent.modelConfig.vision, 'soul_gateway/plan');
            assert.strictEqual(agent.modelConfig.free, 'soul_gateway/fast');
            assert.strictEqual(agent.modelConfig.coding, 'soul_gateway/code');
        });

        it('accepts custom modelConfig', () => {
            const customConfig = {
                thinking: 'claude-sonnet-4',
                fast: 'gpt-4o-mini',
                code: 'claude-sonnet-4',
                writing: 'gpt-4o',
            };
            const agent = new LLMAgent({ modelConfig: customConfig });
            assert.deepStrictEqual(agent.modelConfig, customConfig);
        });

        it('setModelConfig updates the config', () => {
            const agent = new LLMAgent();
            const newConfig = { thinking: 'new-model', fast: 'fast-model' };
            agent.setModelConfig(newConfig);
            assert.deepStrictEqual(agent.modelConfig, newConfig);
        });

        it('setModelConfig with null resets to LLMConfig.json defaults', () => {
            const agent = new LLMAgent({ modelConfig: { thinking: 'custom' } });
            agent.setModelConfig(null);
            assert.strictEqual(agent.modelConfig.thinking, 'soul_gateway/plan');
            assert.strictEqual(agent.modelConfig.fast, 'soul_gateway/fast');
        });
    });
});

describe('MainAgent modelConfig', () => {
    let tempDir;

    beforeEach(() => {
        tempDir = fs.mkdtempSync('/tmp/mainagent-modelconfig-');
    });

    afterEach(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('forwards modelConfig to LLMAgent', () => {
        const customConfig = {
            thinking: 'custom-thinking-model',
            fast: 'custom-fast-model',
        };
        const agent = new MainAgent({
            startDir: tempDir,
            modelConfig: customConfig,
        });
        assert.deepStrictEqual(agent.llmAgent.modelConfig, customConfig);
    });

    it('uses default modelConfig from LLMConfig.json when not provided', () => {
        const agent = new MainAgent({ startDir: tempDir });
        assert.ok(agent.llmAgent.modelConfig);
        assert.strictEqual(agent.llmAgent.modelConfig.thinking, 'soul_gateway/plan');
    });

    it('forwards modelConfig to SubsystemFactory', () => {
        const customConfig = {
            thinking: 'custom-model',
            code: 'custom-code-model',
        };
        const agent = new MainAgent({
            startDir: tempDir,
            modelConfig: customConfig,
        });
        assert.strictEqual(agent.subsystemFactory.modelConfig, customConfig);
    });

    it('custom modelConfig overrides defaults', () => {
        const customConfig = {
            thinking: 'claude-3-5-sonnet',
            fast: 'gpt-4o-mini',
            code: 'claude-3-5-sonnet',
            writing: 'gpt-4o',
            research: 'claude-3-opus',
            'long-context': 'claude-3-opus',
            vision: 'gpt-4o',
            free: 'gpt-4o-mini',
            coding: 'claude-3-5-sonnet',
        };
        const agent = new MainAgent({
            startDir: tempDir,
            modelConfig: customConfig,
        });
        assert.strictEqual(agent.llmAgent.modelConfig.thinking, 'claude-3-5-sonnet');
        assert.strictEqual(agent.llmAgent.modelConfig.fast, 'gpt-4o-mini');
        assert.strictEqual(agent.llmAgent.modelConfig.code, 'claude-3-5-sonnet');
        assert.strictEqual(agent.llmAgent.modelConfig.writing, 'gpt-4o');
        assert.strictEqual(agent.llmAgent.modelConfig.research, 'claude-3-opus');
    });
});
