#!/usr/bin/env node
/**
 * Test: Model Selection — verifies that the invoker resolves a single model
 * (no cascade) based on model selectors, tags, or defaults.
 *
 * Usage: node tests/test-model-selection.mjs
 *
 * Uses __setCallLLMWithModelForTests to intercept real HTTP calls.
 */

// ── Helpers ──────────────────────────────────────────────────────────
const COLORS = {
    RESET: '\x1b[0m',
    RED:   '\x1b[31m',
    GREEN: '\x1b[32m',
    YELLOW:'\x1b[33m',
    CYAN:  '\x1b[36m',
    BOLD:  '\x1b[1m',
};

let passed = 0;
let failed = 0;

function assert(condition, msg) {
    if (condition) {
        console.log(`  ${COLORS.GREEN}✓${COLORS.RESET} ${msg}`);
        passed++;
    } else {
        console.log(`  ${COLORS.RED}✗${COLORS.RESET} ${msg}`);
        failed++;
    }
}

// ── Load achillesAgentLib ────────────────────────────────────────────
import {
    loadModelsConfiguration,
    listModelsFromCache,
    getPrioritizedModels,
    resolveModelForInvocation,
    selectModelByTags,
    defaultLLMInvokerStrategy,
    __setCallLLMWithModelForTests,
    __resetCallLLMWithModelForTests,
} from '../utils/LLMClient.mjs';

console.log(`${COLORS.BOLD}${COLORS.CYAN}Loading model configuration...${COLORS.RESET}`);
await loadModelsConfiguration();

// ── Test 1: Models are populated ────────────────────────────────────
console.log(`\n${COLORS.BOLD}Test 1: Models are discovered from gateway${COLORS.RESET}`);
const discoveredModels = listModelsFromCache();
const totalModels = discoveredModels.fast.length + discoveredModels.deep.length;
assert(totalModels > 0, `models discovered (found ${totalModels})`);
assert(discoveredModels.fast.length > 0 || discoveredModels.deep.length > 0, `at least one model available`);

// ── Test 2: resolveModelForInvocation with explicit model ───────────
console.log(`\n${COLORS.BOLD}Test 2: Explicit model passes through${COLORS.RESET}`);
const allModels = listModelsFromCache();
const someModel = (allModels.fast[0] || allModels.deep[0])?.name;
if (someModel) {
    const resolved = resolveModelForInvocation({ model: someModel });
    assert(resolved === someModel, `explicit model "${someModel}" passes through`);
}

// Unknown model passes through for gateway resolution
const unknownResolved = resolveModelForInvocation({ model: 'unknown-model-xyz' });
assert(unknownResolved === 'unknown-model-xyz', `unknown model name passes through for gateway`);

// ── Test 3: resolveModelForInvocation selector behavior ──────────────
console.log(`\n${COLORS.BOLD}Test 3: Selector intents resolve to configured models${COLORS.RESET}`);
const planResolved = resolveModelForInvocation({ model: 'plan' });
assert(typeof planResolved === 'string' && planResolved.length > 0, `model:"plan" resolves to "${planResolved}"`);

const codeResolved = resolveModelForInvocation({ model: 'code' });
assert(typeof codeResolved === 'string' && codeResolved.length > 0, `model:"code" resolves to "${codeResolved}"`);

// ── Test 4: resolveModelForInvocation with no args uses default ─────
console.log(`\n${COLORS.BOLD}Test 4: No args resolves to default selector${COLORS.RESET}`);
const defaultResolved = resolveModelForInvocation({});
assert(typeof defaultResolved === 'string' && defaultResolved.length > 0, `no args resolves to "${defaultResolved}"`);

// ── Test 5: selectModelByTags ───────────────────────────────────────
console.log(`\n${COLORS.BOLD}Test 5: Tag-based model selection${COLORS.RESET}`);
// Tags may or may not be available depending on gateway discovery.
// Test the function doesn't crash and returns null when no tags match.
const noMatchResult = selectModelByTags(['nonexistent-tag-xyz']);
assert(noMatchResult === null || typeof noMatchResult === 'string', `selectModelByTags returns null or string for no-match tags`);

// If any models have tags, test tag matching
let hasModelWithTags = false;
for (const models of [allModels.fast, allModels.deep]) {
    for (const m of models) {
        if (m.tags && m.tags.length > 0) {
            hasModelWithTags = true;
            const result = selectModelByTags([m.tags[0]]);
            assert(typeof result === 'string', `selectModelByTags([${m.tags[0]}]) returns a model`);
            break;
        }
    }
    if (hasModelWithTags) break;
}
if (!hasModelWithTags) {
    console.log(`  ${COLORS.YELLOW}⚠${COLORS.RESET} no models with tags found (gateway discovery may not be available)`);
}

// ── Test 6: No cascade — single call only ───────────────────────────
console.log(`\n${COLORS.BOLD}Test 6: No cascade — single call, failure throws immediately${COLORS.RESET}`);

const callLog = [];
__setCallLLMWithModelForTests(async (modelName, history, prompt, options) => {
    callLog.push(modelName);
    throw new Error(`test: forced failure for ${modelName}`);
});

try {
    callLog.length = 0;
    try {
        await defaultLLMInvokerStrategy({
            prompt: 'test no cascade',
            model: 'plan',
        });
        assert(false, 'should have thrown');
    } catch (err) {
        assert(callLog.length === 1, `only 1 model was tried (no cascade), got ${callLog.length}`);
        assert(err.message.includes('forced failure'), `error propagated directly`);
    }

    // ── Test 7: Specific model bypasses selector intent ─────────────
    console.log(`\n${COLORS.BOLD}Test 7: Specific model name bypasses selector intent${COLORS.RESET}`);
    if (someModel) {
        callLog.length = 0;
        try {
            await defaultLLMInvokerStrategy({
                prompt: 'test specific model',
                model: someModel,
                tags: ['plan'], // should be ignored when explicit model is provided
            });
        } catch (err) {
            assert(callLog.length === 1, `specific model: only 1 call made`);
            assert(callLog[0] === someModel, `specific model: called "${someModel}"`);
        }
    }

    // ── Test 8: First success returns immediately ───────────────────
    console.log(`\n${COLORS.BOLD}Test 8: Successful call returns result${COLORS.RESET}`);
    callLog.length = 0;
    __setCallLLMWithModelForTests(async (modelName, history, prompt, options) => {
        callLog.push(modelName);
        return `success from ${modelName}`;
    });

    try {
        const result = await defaultLLMInvokerStrategy({
            prompt: 'test success',
            model: 'plan',
        });
        assert(callLog.length === 1, `single call made`);
        assert(typeof result.output === 'string', `result has output string`);
        assert(typeof result.model === 'string', `result has model name`);
    } catch (err) {
        assert(false, `unexpected error: ${err.message}`);
    }

    // ── Test 9: getPrioritizedModels with selector intent ───────────
    console.log(`\n${COLORS.BOLD}Test 9: getPrioritizedModels with selector intent${COLORS.RESET}`);
    const prioritized = getPrioritizedModels('plan');
    assert(Array.isArray(prioritized), `getPrioritizedModels returns array`);
    assert(prioritized.length >= 1, `getPrioritizedModels returns at least 1 model`);

} finally {
    __resetCallLLMWithModelForTests();
}

// ── Summary ──────────────────────────────────────────────────────────
console.log(`\n${COLORS.BOLD}${COLORS.CYAN}════════════════════════════════════${COLORS.RESET}`);
console.log(`  ${COLORS.GREEN}Passed: ${passed}${COLORS.RESET}`);
if (failed > 0) {
    console.log(`  ${COLORS.RED}Failed: ${failed}${COLORS.RESET}`);
}
console.log(`${COLORS.BOLD}${COLORS.CYAN}════════════════════════════════════${COLORS.RESET}`);

process.exit(failed > 0 ? 1 : 0);
