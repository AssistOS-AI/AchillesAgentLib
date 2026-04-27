/**
 * Integration tests for callLLMStreaming() against real LLM APIs.
 *
 * All tests use axiologic_proxy models to keep costs at zero.  Each test sends
 * a tiny prompt ("Say hi") and verifies the streaming contract:
 *   - At least one text_delta chunk
 *   - A final done chunk with non-empty fullText
 *   - No error chunks
 *
 * Requires AXIOLOGIC_PROXY_API_KEY loaded from ~/work/.env.
 * Run:  node --test tests/providers/streaming.integration.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { callLLMStreaming as openaiStreaming } from '../../utils/LLMProviders/providers/openai.mjs';

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

const API_KEY = getKey('AXIOLOGIC_PROXY_API_KEY');
const BASE_URL = 'https://proxy.axiologic.dev/v1/chat/completions';

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

function proxyTest(label, model, timeout = 30000) {
    test(`openai.mjs — axiologic_proxy / ${label}`, { timeout }, async () => {
        if (!API_KEY) return test.skip('AXIOLOGIC_PROXY_API_KEY not set');
        await collectAndVerify(
            openaiStreaming(SIMPLE_HISTORY, { model, apiKey: API_KEY, baseURL: BASE_URL }),
            `axiologic_proxy/${label}`,
        );
    });
}

// ===========================================================================
// Fast models
// ===========================================================================

proxyTest('Gemini 2.5 Flash Lite', 'gemini-2.5-flash-lite');
proxyTest('Gemini 2.5 Flash', 'gemini-2.5-flash');

// ===========================================================================
// Deep models
// ===========================================================================

proxyTest('GPT 5.3 Codex', 'gpt-5.3-codex', 60000);
proxyTest('GPT 5.2 Codex', 'gpt-5.2-codex', 60000);
proxyTest('GPT 5.2', 'gpt-5.2', 60000);
proxyTest('GPT 5.1 Codex', 'gpt-5.1-codex', 60000);
proxyTest('Gemini 2.5 Pro', 'gemini-2.5-pro', 60000);
