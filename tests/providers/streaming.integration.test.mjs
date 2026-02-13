/**
 * Integration tests for callLLMStreaming() against real LLM APIs.
 *
 * Uses cheap/free models to keep costs minimal.  Each test sends a tiny prompt
 * ("Say hi") and verifies the streaming contract:
 *   - At least one text_delta chunk
 *   - A final done chunk with non-empty fullText
 *   - No error chunks
 *
 * Requires API keys loaded from ~/work/.env.
 * Run:  node --test tests/providers/streaming.integration.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { callLLMStreaming as openaiStreaming } from '../../utils/LLMProviders/providers/openai.mjs';
import { callLLMStreaming as anthropicStreaming } from '../../utils/LLMProviders/providers/anthropic.mjs';
import { callLLMStreaming as openaiResponsesStreaming } from '../../utils/LLMProviders/providers/openaiResponses.mjs';

// ---------------------------------------------------------------------------
// Load env
// ---------------------------------------------------------------------------

function loadEnv() {
    const envPath = join(process.env.HOME, 'work', '.env');
    const env = {};
    try {
        const lines = readFileSync(envPath, 'utf8').split('\n');
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;
            const match = trimmed.match(/^([A-Z_][A-Z0-9_]*)\s+(.+)$/) ||
                          trimmed.match(/^([A-Z_][A-Z0-9_]*)=(.+)$/);
            if (match) {
                env[match[1]] = match[2].trim();
            }
        }
    } catch {
        // .env not found
    }
    return env;
}

const ENV = loadEnv();

function getKey(name) {
    return process.env[name] || ENV[name] || '';
}

const OPENROUTER_KEY = getKey('OPENROUTER_API_KEY');
const OPENCODE_KEY = 'sk-fYXKk5M16ORDO6ohiHeAEwPn7ukTHGv7w5fNINnirwDWR7fp5mbW9Jy2aumuO2AA';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SIMPLE_HISTORY = [
    { role: 'user', message: 'Say the word "hello" and nothing else.' },
];

async function collectAndVerify(gen, label) {
    const chunks = [];
    for await (const chunk of gen) {
        chunks.push(chunk);
    }

    const errors = chunks.filter(c => c.type === 'error');
    if (errors.length) {
        console.log(`  [${label}] ERROR chunks:`, errors.map(e => e.error.message));
    }
    assert.equal(errors.length, 0, `${label}: should have no error chunks`);

    const textDeltas = chunks.filter(c => c.type === 'text_delta');
    assert.ok(textDeltas.length > 0, `${label}: should have at least one text_delta`);

    const done = chunks.find(c => c.type === 'done');
    assert.ok(done, `${label}: should have a done chunk`);
    assert.ok(done.fullText.length > 0, `${label}: fullText should be non-empty`);

    // The accumulated fullText should match concatenation of all text_delta texts
    const accumulated = textDeltas.map(c => c.text).join('');
    assert.equal(done.fullText, accumulated, `${label}: fullText should equal concatenated deltas`);

    console.log(`  [${label}] OK — ${textDeltas.length} deltas, fullText: "${done.fullText.slice(0, 80)}${done.fullText.length > 80 ? '...' : ''}"`);
    return { chunks, done };
}

// ===========================================================================
// PROVIDER: openai.mjs  (OpenAI Chat Completions format)
// Via OpenRouter — tests multiple backend providers through one gateway
// ===========================================================================

test('openai.mjs — OpenRouter / DeepSeek V3.2', { timeout: 30000 }, async () => {
    if (!OPENROUTER_KEY) return test.skip('OPENROUTER_API_KEY not set');
    await collectAndVerify(
        openaiStreaming(SIMPLE_HISTORY, {
            model: 'deepseek/deepseek-v3.2',
            apiKey: OPENROUTER_KEY,
            baseURL: 'https://openrouter.ai/api/v1/chat/completions',
        }),
        'OpenRouter/DeepSeek-V3.2',
    );
});

test('openai.mjs — OpenRouter / Qwen3 Coder Plus', { timeout: 30000 }, async () => {
    if (!OPENROUTER_KEY) return test.skip('OPENROUTER_API_KEY not set');
    await collectAndVerify(
        openaiStreaming(SIMPLE_HISTORY, {
            model: 'qwen/qwen3-coder-plus',
            apiKey: OPENROUTER_KEY,
            baseURL: 'https://openrouter.ai/api/v1/chat/completions',
        }),
        'OpenRouter/Qwen3-Coder-Plus',
    );
});

test('openai.mjs — OpenRouter / Mistral Codestral', { timeout: 30000 }, async () => {
    if (!OPENROUTER_KEY) return test.skip('OPENROUTER_API_KEY not set');
    await collectAndVerify(
        openaiStreaming(SIMPLE_HISTORY, {
            model: 'mistralai/codestral-2508',
            apiKey: OPENROUTER_KEY,
            baseURL: 'https://openrouter.ai/api/v1/chat/completions',
        }),
        'OpenRouter/Codestral-2508',
    );
});

test('openai.mjs — OpenRouter / Google Gemini 2.5 Flash', { timeout: 30000 }, async () => {
    if (!OPENROUTER_KEY) return test.skip('OPENROUTER_API_KEY not set');
    await collectAndVerify(
        openaiStreaming(SIMPLE_HISTORY, {
            model: 'google/gemini-2.5-flash',
            apiKey: OPENROUTER_KEY,
            baseURL: 'https://openrouter.ai/api/v1/chat/completions',
        }),
        'OpenRouter/Gemini-2.5-Flash',
    );
});

test('openai.mjs — OpenRouter / Anthropic Claude Haiku 4.5', { timeout: 30000 }, async () => {
    if (!OPENROUTER_KEY) return test.skip('OPENROUTER_API_KEY not set');
    await collectAndVerify(
        openaiStreaming(SIMPLE_HISTORY, {
            model: 'anthropic/claude-haiku-4.5',
            apiKey: OPENROUTER_KEY,
            baseURL: 'https://openrouter.ai/api/v1/chat/completions',
        }),
        'OpenRouter/Claude-Haiku-4.5',
    );
});

test('openai.mjs — OpenRouter / xAI Grok 4.1 Fast', { timeout: 30000 }, async () => {
    if (!OPENROUTER_KEY) return test.skip('OPENROUTER_API_KEY not set');
    await collectAndVerify(
        openaiStreaming(SIMPLE_HISTORY, {
            model: 'x-ai/grok-4.1-fast',
            apiKey: OPENROUTER_KEY,
            baseURL: 'https://openrouter.ai/api/v1/chat/completions',
        }),
        'OpenRouter/Grok-4.1-Fast',
    );
});

// Via OpenCode (OpenAI-compatible proxy)

test('openai.mjs — OpenCode / GPT 5.2', { timeout: 30000 }, async () => {
    await collectAndVerify(
        openaiStreaming(SIMPLE_HISTORY, {
            model: 'gpt-5.2',
            apiKey: OPENCODE_KEY,
            baseURL: 'https://opencode.ai/zen/v1/chat/completions',
        }),
        'OpenCode/GPT-5.2',
    );
});

test('openai.mjs — OpenCode / Claude Haiku 4.5', { timeout: 30000 }, async () => {
    await collectAndVerify(
        openaiStreaming(SIMPLE_HISTORY, {
            model: 'claude-haiku-4-5',
            apiKey: OPENCODE_KEY,
            baseURL: 'https://opencode.ai/zen/v1/chat/completions',
        }),
        'OpenCode/Claude-Haiku-4.5',
    );
});

// ===========================================================================
// PROVIDER: anthropic.mjs  (Anthropic Messages API format)
// Via OpenCode Anthropic-compatible endpoint
// ===========================================================================

test('anthropic.mjs — OpenCode / Claude Sonnet 4.5', { timeout: 45000 }, async () => {
    await collectAndVerify(
        anthropicStreaming(SIMPLE_HISTORY, {
            model: 'claude-sonnet-4-5',
            apiKey: OPENCODE_KEY,
            baseURL: 'https://opencode.ai/zen/v1/messages',
        }),
        'OpenCode-Anthropic/Claude-Sonnet-4.5',
    );
});

test('anthropic.mjs — OpenCode / Claude Haiku 4.5', { timeout: 30000 }, async () => {
    await collectAndVerify(
        anthropicStreaming(SIMPLE_HISTORY, {
            model: 'claude-haiku-4-5',
            apiKey: OPENCODE_KEY,
            baseURL: 'https://opencode.ai/zen/v1/messages',
        }),
        'OpenCode-Anthropic/Claude-Haiku-4.5',
    );
});

// ===========================================================================
// PROVIDER: openaiResponses.mjs  (OpenAI Responses API format)
// Via OpenCode Responses endpoint
// ===========================================================================

test('openaiResponses.mjs — OpenCode / GPT 5.2 Codex', { timeout: 60000 }, async () => {
    await collectAndVerify(
        openaiResponsesStreaming(SIMPLE_HISTORY, {
            model: 'gpt-5.2-codex',
            apiKey: OPENCODE_KEY,
            baseURL: 'https://opencode.ai/zen/v1/responses',
        }),
        'OpenCode-Responses/GPT-5.2-Codex',
    );
});

test('openaiResponses.mjs — OpenCode / GPT 5.1 Codex', { timeout: 60000 }, async () => {
    await collectAndVerify(
        openaiResponsesStreaming(SIMPLE_HISTORY, {
            model: 'gpt-5.1-codex',
            apiKey: OPENCODE_KEY,
            baseURL: 'https://opencode.ai/zen/v1/responses',
        }),
        'OpenCode-Responses/GPT-5.1-Codex',
    );
});
