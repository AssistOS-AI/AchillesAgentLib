import { test, describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
    callSearch,
    extractSearchQuery,
} from '../utils/SearchProviders/search.mjs';
import {
    __setCallLLMWithModelForTests,
    __resetCallLLMWithModelForTests,
} from '../utils/LLMClient.mjs';
import { registerProvider, resetProviders } from '../utils/LLMProviders/providerRegistry.mjs';

// ── Test helpers ────────────────────────────────────────────────────

const fakeHandler = { callLLM: async () => 'mock response' };

function setupSoulGatewayProvider() {
    registerProvider({ key: 'soul_gateway', handler: fakeHandler });
}

// ── extractSearchQuery ──────────────────────────────────────────────

describe('extractSearchQuery', () => {
    it('extracts string content from last user message', () => {
        const messages = [
            { role: 'system', content: 'sys' },
            { role: 'user', content: 'first query' },
            { role: 'assistant', content: 'result' },
            { role: 'user', content: 'second query' },
        ];
        assert.equal(extractSearchQuery(messages), 'second query');
    });

    it('extracts text from multi-part content', () => {
        const messages = [
            {
                role: 'user',
                content: [
                    { type: 'image_url', image_url: { url: 'x' } },
                    { type: 'text', text: 'describe this' },
                ],
            },
        ];
        assert.equal(extractSearchQuery(messages), 'describe this');
    });

    it('returns empty string for empty messages', () => {
        assert.equal(extractSearchQuery([]), '');
    });

    it('returns empty string for non-array input', () => {
        assert.equal(extractSearchQuery(null), '');
        assert.equal(extractSearchQuery(undefined), '');
    });

    it('returns empty string when no user message exists', () => {
        const messages = [
            { role: 'system', content: 'sys' },
            { role: 'assistant', content: 'hi' },
        ];
        assert.equal(extractSearchQuery(messages), '');
    });
});

// ── callSearch model resolution ─────────────────────────────────────

describe('callSearch model resolution', () => {
    let captured;

    beforeEach(() => {
        captured = null;
        setupSoulGatewayProvider();
        __setCallLLMWithModelForTests(async (modelName, history, prompt, opts) => {
            captured = { modelName, history, prompt, opts };
            return 'search result';
        });
    });

    afterEach(() => {
        __resetCallLLMWithModelForTests();
        resetProviders();
    });

    it('provider: "exa" delegates to model search-exa', async () => {
        await callSearch('test query', { provider: 'exa' });
        assert.equal(captured.modelName, 'search-exa');
        assert.equal(captured.prompt, 'test query');
    });

    it('provider: "tavily" delegates to model search-tavily', async () => {
        await callSearch('test', { provider: 'tavily' });
        assert.equal(captured.modelName, 'search-tavily');
    });

    it('provider: "brave" delegates to model search-brave', async () => {
        await callSearch('test', { provider: 'brave' });
        assert.equal(captured.modelName, 'search-brave');
    });

    it('provider: "google-ai-mode" delegates to headless-google-ai-mode', async () => {
        await callSearch('test', { provider: 'google-ai-mode' });
        assert.equal(captured.modelName, 'headless-google-ai-mode');
    });

    it('provider: "gemini-search" delegates to search-gemini', async () => {
        await callSearch('test', { provider: 'gemini-search' });
        assert.equal(captured.modelName, 'search-gemini');
    });

    it('options.model overrides provider mapping', async () => {
        await callSearch('test', { model: 'custom-search-model' });
        assert.equal(captured.modelName, 'custom-search-model');
    });

    it('options.model takes precedence over options.provider', async () => {
        await callSearch('test', { model: 'my-model', provider: 'exa' });
        assert.equal(captured.modelName, 'my-model');
    });
});

// ── callSearch pass-through options ─────────────────────────────────

describe('callSearch pass-through options', () => {
    let captured;

    beforeEach(() => {
        captured = null;
        setupSoulGatewayProvider();
        __setCallLLMWithModelForTests(async (modelName, history, prompt, opts) => {
            captured = { modelName, history, prompt, opts };
            return 'ok';
        });
    });

    afterEach(() => {
        __resetCallLLMWithModelForTests();
        resetProviders();
    });

    it('passes apiKey through', async () => {
        await callSearch('q', { provider: 'exa', apiKey: 'sk-test' });
        assert.equal(captured.opts.apiKey, 'sk-test');
    });

    it('passes apiKeyEnv through', async () => {
        await callSearch('q', { provider: 'exa', apiKeyEnv: 'MY_KEY' });
        assert.equal(captured.opts.apiKeyEnv, 'MY_KEY');
    });

    it('passes baseURL through', async () => {
        await callSearch('q', { provider: 'exa', baseURL: 'https://my.gateway/v1' });
        assert.equal(captured.opts.baseURL, 'https://my.gateway/v1');
    });

    it('passes headers through', async () => {
        await callSearch('q', { provider: 'exa', headers: { 'X-Custom': 'val' } });
        assert.deepEqual(captured.opts.headers, { 'X-Custom': 'val' });
    });

    it('passes params through', async () => {
        await callSearch('q', { provider: 'exa', params: { max_results: 5 } });
        assert.deepEqual(captured.opts.params, { max_results: 5 });
    });

    it('passes signal through', async () => {
        const controller = new AbortController();
        await callSearch('q', { provider: 'exa', signal: controller.signal });
        assert.equal(captured.opts.signal, controller.signal);
    });

    it('sets providerKey to soul_gateway by default', async () => {
        await callSearch('q', { provider: 'exa' });
        assert.equal(captured.opts.providerKey, 'soul_gateway');
    });

    it('allows providerKey override', async () => {
        registerProvider({ key: 'my_openai', handler: fakeHandler });
        await callSearch('q', { provider: 'exa', providerKey: 'my_openai' });
        assert.equal(captured.opts.providerKey, 'my_openai');
    });

    it('does not leak provider/model/providerKey as duplicate keys', async () => {
        await callSearch('q', { provider: 'exa' });
        assert.equal(captured.opts.provider, undefined);
    });
});

// ── callSearch with message arrays ──────────────────────────────────

describe('callSearch with message input', () => {
    let captured;

    beforeEach(() => {
        captured = null;
        setupSoulGatewayProvider();
        __setCallLLMWithModelForTests(async (modelName, history, prompt, opts) => {
            captured = { modelName, history, prompt, opts };
            return 'ok';
        });
    });

    afterEach(() => {
        __resetCallLLMWithModelForTests();
        resetProviders();
    });

    it('extracts query from message array', async () => {
        const messages = [
            { role: 'user', content: 'search this' },
        ];
        await callSearch(messages, { provider: 'brave' });
        assert.equal(captured.prompt, 'search this');
        assert.equal(captured.modelName, 'search-brave');
    });
});

// ── callSearch error handling ───────────────────────────────────────

describe('callSearch error handling', () => {
    afterEach(() => {
        __resetCallLLMWithModelForTests();
        resetProviders();
    });

    it('throws when neither model nor provider is specified', async () => {
        setupSoulGatewayProvider();
        await assert.rejects(
            () => callSearch('test', {}),
            /callSearch requires options\.model or options\.provider/
        );
    });

    it('throws a clear error when soul_gateway provider is not registered', async () => {
        resetProviders();
        await assert.rejects(
            () => callSearch('test', { provider: 'exa' }),
            /SOUL_GATEWAY_API_KEY/
        );
    });

    it('throws a clear error when a custom providerKey is not registered', async () => {
        resetProviders();
        await assert.rejects(
            () => callSearch('test', { provider: 'exa', providerKey: 'my_gw' }),
            /not configured/
        );
    });
});

// ── Static invariant: no vendor HTTP code ───────────────────────────

describe('static invariant: Achilles search helper', () => {
    const searchModulePath = path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        '../utils/SearchProviders/search.mjs'
    );
    const source = readFileSync(searchModulePath, 'utf8');

    it('contains no vendor URLs', () => {
        const vendorUrls = [
            'api.tavily.com',
            'api.search.brave.com',
            'api.exa.ai',
            'google.serper.dev',
            's.jina.ai',
            'api.duckduckgo.com',
            'generativelanguage.googleapis.com',
            'searx.be',
        ];
        for (const url of vendorUrls) {
            assert.ok(!source.includes(url), `source must not contain ${url}`);
        }
    });

    it('contains no raw fetch() calls', () => {
        assert.doesNotMatch(source, /\bfetch\s*\(/);
    });

    it('contains no node:http or node:https imports', () => {
        assert.doesNotMatch(source, /from\s+['"]node:https?['"]/);
    });

    it('imports from LLMClient, not from vendor modules', () => {
        assert.match(source, /from\s+['"]\.\.\/LLMClient\.mjs['"]/);
    });
});
