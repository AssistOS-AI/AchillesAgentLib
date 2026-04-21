import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    discoverModels,
    normalizeGatewayModelMetadata,
    normalizeGatewayPricing,
} from '../utils/LLMProviders/providers/gatewayDiscovery.mjs';

test('normalizeGatewayPricing prefers Soul Gateway v2 pricing fields', () => {
    const pricing = normalizeGatewayPricing({
        _pricing: {
            mode: 'token',
            input_per_million: '1.25',
            output_per_million: 4,
            request: '0.05',
        },
        input_price: '99',
        output_price: '88',
        request_price: '77',
    });

    assert.deepEqual(pricing, {
        mode: 'token',
        inputPricePerMillion: 1.25,
        outputPricePerMillion: 4,
        requestPrice: 0.05,
    });
});

test('normalizeGatewayModelMetadata prefers v2 fields and normalizes tags', () => {
    const metadata = normalizeGatewayModelMetadata({
        _is_free: true,
        _tags: [' Fast ', 'coding', 'FAST', null, ''],
        _context: {
            window: '32768',
            max_output_tokens: 4096,
        },
        _pricing: {
            mode: 'token',
            input_per_million: '0.15',
            output_per_million: '0.6',
            request: null,
        },
        is_free: false,
        tags: ['legacy'],
        context_window: 1024,
    });

    assert.deepEqual(metadata, {
        isFree: true,
        tags: ['fast', 'coding'],
        contextWindow: 32768,
        maxOutputTokens: 4096,
        pricing: {
            mode: 'token',
            inputPricePerMillion: 0.15,
            outputPricePerMillion: 0.6,
            requestPrice: null,
        },
    });
});

test('discoverModels keeps explicit legacy tier but does not invent one for v2 models', async () => {
    const originalFetch = globalThis.fetch;
    const originalApiKey = process.env.TEST_GATEWAY_KEY;
    let requestedURL = null;
    let authHeader = null;

    process.env.TEST_GATEWAY_KEY = 'secret-token';
    globalThis.fetch = async (url, init) => {
        requestedURL = url;
        authHeader = init?.headers?.Authorization;
        return {
            ok: true,
            async json() {
                return {
                    data: [
                        {
                            id: 'gemma4:31b',
                            _tags: [' Reasoning ', 'FAST', 'reasoning'],
                            _is_free: true,
                            _context: {
                                window: 131072,
                                max_output_tokens: '8192',
                            },
                            _pricing: {
                                mode: 'token',
                                input_per_million: '0.25',
                                output_per_million: '0.75',
                            },
                            sort_order: 5,
                            billing_type: 'org_quota',
                        },
                        {
                            id: 'legacy-deep',
                            tier: 'deep',
                            tags: ['analysis'],
                            is_free: false,
                            input_price: '1',
                            output_price: '2',
                            context_window: 4096,
                            sort_order: 10,
                        },
                    ],
                };
            },
        };
    };

    try {
        const result = await discoverModels({
            providerKey: 'soul_gateway',
            baseURL: 'https://gateway.example/v1/chat/completions',
            apiKeyEnv: 'TEST_GATEWAY_KEY',
        });

        assert.equal(requestedURL, 'https://gateway.example/v1/models');
        assert.equal(authHeader, 'Bearer secret-token');
        assert.deepEqual(result.issues, { errors: [], warnings: [] });
        assert.equal(result.models.length, 2);

        const [gemma, legacy] = result.models;

        assert.equal(gemma.name, 'gemma4:31b');
        assert.equal(Object.hasOwn(gemma, 'tier'), false);
        assert.deepEqual(gemma.tags, ['reasoning', 'fast']);
        assert.equal(gemma.isFree, true);
        assert.equal(gemma.context, 131072);
        assert.equal(gemma.maxOutputTokens, 8192);
        assert.deepEqual(gemma.pricing, {
            mode: 'token',
            inputPricePerMillion: 0.25,
            outputPricePerMillion: 0.75,
            requestPrice: null,
        });
        assert.equal(gemma.billingType, 'org_quota');

        assert.equal(legacy.name, 'legacy-deep');
        assert.equal(legacy.tier, 'deep');
        assert.deepEqual(legacy.tags, ['analysis']);
        assert.equal(legacy.context, 4096);
        assert.deepEqual(legacy.pricing, {
            mode: null,
            inputPricePerMillion: 1,
            outputPricePerMillion: 2,
            requestPrice: null,
        });
    } finally {
        if (originalFetch === undefined) {
            delete globalThis.fetch;
        } else {
            globalThis.fetch = originalFetch;
        }

        if (originalApiKey === undefined) {
            delete process.env.TEST_GATEWAY_KEY;
        } else {
            process.env.TEST_GATEWAY_KEY = originalApiKey;
        }
    }
});
