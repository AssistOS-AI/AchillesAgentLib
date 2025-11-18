import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    configureLLMLogger,
    logLLMInteraction,
    getLLMStats,
    resetLLMLogger,
} from '../../utils/LLMLogger.mjs';

const TEMP_ROOT = path.join(process.cwd(), 'tests', '.tmp', 'llm-logger');

const createTempFile = (prefix) => {
    fs.mkdirSync(TEMP_ROOT, { recursive: true });
    return path.join(TEMP_ROOT, `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}.log`);
};

test('LLM logger buckets reflect request duration thresholds', async () => {
    try {
        resetLLMLogger();
        const statsFile = createTempFile('stats');
        const logsFile = createTempFile('logs');
        [statsFile, logsFile].forEach((filePath) => {
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        });
        configureLLMLogger({ statsFile, logsFile });

        logLLMInteraction({ prompt: 'short', response: 'ok', model: 'auto', durationMs: 50 });
        logLLMInteraction({ prompt: 'mid', response: 'ok', model: 'auto', durationMs: 500 });
        logLLMInteraction({ prompt: 'long', response: 'ok', model: 'auto', durationMs: 15_000 });

        const stats = getLLMStats();
        assert.equal(stats.buckets['<100'].requests, 1);
        assert.equal(stats.buckets['<1000'].requests, 1);
        assert.equal(stats.buckets['<10000'].requests, 0);
        assert.equal(stats.buckets['<100000'].requests, 1);
        assert.equal(stats.buckets['<100'].minMs, 50);
        assert.equal(stats.buckets['<100000'].maxMs, 15_000);
    } catch (error) {
        console.error('llm logger test failure:', error);
        throw error;
    }
});
