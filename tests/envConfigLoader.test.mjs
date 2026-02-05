/**
 * Test script for envConfigLoader.mjs
 * Tests provider and model parsing from environment variables.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import {
    loadEnvConfig,
    parseModelReference,
    parseModelList,
    parseModelDefinition,
} from '../utils/LLMProviders/providers/envConfigLoader.mjs';

describe('envConfigLoader', () => {
    describe('parseModelReference', () => {
        it('should parse provider/model format', () => {
            const result = parseModelReference('myproxy/gpt-4-turbo');
            assert.strictEqual(result.provider, 'myproxy');
            assert.strictEqual(result.model, 'gpt-4-turbo');
        });

        it('should handle simple model name', () => {
            const result = parseModelReference('gpt-4-turbo');
            assert.strictEqual(result.provider, null);
            assert.strictEqual(result.model, 'gpt-4-turbo');
        });

        it('should handle null/undefined', () => {
            const result = parseModelReference(null);
            assert.strictEqual(result.provider, null);
        });
    });

    describe('parseModelList', () => {
        it('should parse comma-separated list', () => {
            const result = parseModelList('myproxy/gpt-4,bedrock/claude-3,gpt-4o');
            assert.strictEqual(result.length, 3);
            assert.strictEqual(result[0].provider, 'myproxy');
            assert.strictEqual(result[0].model, 'gpt-4');
            assert.strictEqual(result[1].provider, 'bedrock');
            assert.strictEqual(result[1].model, 'claude-3');
            assert.strictEqual(result[2].provider, null);
            assert.strictEqual(result[2].model, 'gpt-4o');
        });

        it('should parse semicolon-separated list', () => {
            const result = parseModelList('myproxy/gpt-4;bedrock/claude-3');
            assert.strictEqual(result.length, 2);
        });

        it('should parse JSON array', () => {
            const result = parseModelList('["myproxy/gpt-4", "bedrock/claude-3"]');
            assert.strictEqual(result.length, 2);
            assert.strictEqual(result[0].provider, 'myproxy');
        });
    });

    describe('parseModelDefinition', () => {
        it('should parse full model definition', () => {
            const result = parseModelDefinition('myproxy/gpt-4-turbo|deep|5|15|128k');
            assert.strictEqual(result.provider, 'myproxy');
            assert.strictEqual(result.name, 'gpt-4-turbo');
            assert.strictEqual(result.mode, 'deep');
            assert.strictEqual(result.inputPrice, 5);
            assert.strictEqual(result.outputPrice, 15);
            assert.strictEqual(result.context, '128k');
        });

        it('should parse minimal model definition', () => {
            const result = parseModelDefinition('myproxy/gpt-4-turbo|fast');
            assert.strictEqual(result.provider, 'myproxy');
            assert.strictEqual(result.name, 'gpt-4-turbo');
            assert.strictEqual(result.mode, 'fast');
            assert.strictEqual(result.inputPrice, 0);
            assert.strictEqual(result.outputPrice, 0);
        });

        it('should return null for invalid format', () => {
            const result = parseModelDefinition('gpt-4-turbo'); // No provider
            assert.strictEqual(result, null);
        });
    });

    describe('loadEnvConfig with providers', () => {
        const originalEnv = { ...process.env };

        beforeEach(() => {
            // Clear relevant env vars
            for (const key of Object.keys(process.env)) {
                if (key.startsWith('OPENAI_') || key.startsWith('ANTHROPIC_') || key.startsWith('LLM_MODEL_')) {
                    if (!key.endsWith('_API_KEY')) {
                        delete process.env[key];
                    }
                }
            }
        });

        afterEach(() => {
            // Restore original env
            for (const key of Object.keys(process.env)) {
                if (key.startsWith('OPENAI_') || key.startsWith('ANTHROPIC_') || key.startsWith('LLM_MODEL_')) {
                    delete process.env[key];
                }
            }
            Object.assign(process.env, originalEnv);
        });

        it('should parse OPENAI provider from env', () => {
            process.env.OPENAI_MYPROXY_URL = 'https://myproxy.example.com/v1/chat/completions';
            process.env.OPENAI_MYPROXY_KEY = 'sk-test-key';

            const config = loadEnvConfig();
            
            assert.ok(config.providers.has('myproxy'));
            const provider = config.providers.get('myproxy');
            assert.strictEqual(provider.baseURL, 'https://myproxy.example.com/v1/chat/completions');
            assert.ok(provider.module.includes('openai.mjs'));
        });

        it('should parse ANTHROPIC provider from env', () => {
            process.env.ANTHROPIC_BEDROCK_URL = 'https://bedrock.example.com/v1/messages';
            process.env.ANTHROPIC_BEDROCK_KEY_ENV = 'AWS_BEDROCK_KEY';

            const config = loadEnvConfig();
            
            assert.ok(config.providers.has('bedrock'));
            const provider = config.providers.get('bedrock');
            assert.strictEqual(provider.baseURL, 'https://bedrock.example.com/v1/messages');
            assert.ok(provider.module.includes('anthropic.mjs'));
            assert.strictEqual(provider.apiKeyEnv, 'AWS_BEDROCK_KEY');
        });

        it('should parse LLM_MODEL_* from env', () => {
            process.env.OPENAI_MYPROXY_URL = 'https://myproxy.example.com/v1/chat/completions';
            process.env.LLM_MODEL_01 = 'myproxy/gpt-4-turbo|deep|5|15|128k';
            process.env.LLM_MODEL_02 = 'myproxy/gpt-4o-mini|fast|0.15|0.6|128k';

            const config = loadEnvConfig();
            
            assert.strictEqual(config.models.length, 2);
            assert.strictEqual(config.models[0].name, 'gpt-4-turbo');
            assert.strictEqual(config.models[0].provider, 'myproxy');
            assert.strictEqual(config.models[0].mode, 'deep');
            assert.strictEqual(config.models[1].name, 'gpt-4o-mini');
            assert.strictEqual(config.models[1].mode, 'fast');
        });
    });
});

console.log('Running envConfigLoader tests...');
