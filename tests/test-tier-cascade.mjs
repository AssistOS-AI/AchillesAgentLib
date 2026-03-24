#!/usr/bin/env node
/**
 * Test: Tier Cascade — verifies that the invoker tries every model
 * in a tier (including fallback chains) in the correct order.
 *
 * Usage: node tests/test-tier-cascade.mjs
 *
 * Uses __setCallLLMWithModelForTests to intercept real HTTP calls.
 * Every call is recorded and forced to reject, so the cascade must
 * exhaust the full model list for each tier.
 */

// ── Helpers ──────────────────────────────────────────────────────────
const COLORS = {
    RESET: '\x1b[0m',
    RED:   '\x1b[31m',
    GREEN: '\x1b[32m',
    YELLOW:'\x1b[33m',
    CYAN:  '\x1b[36m',
    GRAY:  '\x1b[90m',
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

function assertDeepEqual(actual, expected, msg) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a === e) {
        console.log(`  ${COLORS.GREEN}✓${COLORS.RESET} ${msg}`);
        passed++;
    } else {
        console.log(`  ${COLORS.RED}✗${COLORS.RESET} ${msg}`);
        console.log(`    expected: ${e}`);
        console.log(`    actual:   ${a}`);
        failed++;
    }
}

// ── Load achillesAgentLib ────────────────────────────────────────────
import {
    loadModelsConfiguration,
    listTiersFromCache,
    listModelsFromCache,
    getPrioritizedModels,
    defaultLLMInvokerStrategy,
    __setCallLLMWithModelForTests,
    __resetCallLLMWithModelForTests,
} from '../utils/LLMClient.mjs';

// Load config (builds caches, tier map, etc.)
console.log(`${COLORS.BOLD}${COLORS.CYAN}Loading model configuration...${COLORS.RESET}`);
await loadModelsConfiguration();

// ── Show resolved tiers ──────────────────────────────────────────────
const tiers = listTiersFromCache();
const tierNames = Object.keys(tiers);

console.log(`\n${COLORS.BOLD}${COLORS.CYAN}=== Resolved Tiers ===${COLORS.RESET}`);
for (const name of tierNames) {
    const models = tiers[name];
    console.log(`  ${COLORS.BOLD}${name}${COLORS.RESET} (${models.length} models): ${models.join(' → ')}`);
}

// ── Test 1: Tier map is populated ────────────────────────────────────
console.log(`\n${COLORS.BOLD}Test 1: Tier map is populated${COLORS.RESET}`);
assert(tierNames.length > 0, `tier map has entries (found ${tierNames.length})`);
assert(tiers.fast && tiers.fast.length > 0, `"fast" tier has models`);
assert(tiers.deep && tiers.deep.length > 0, `"deep" tier has models`);
assert(tiers.code && tiers.code.length > 0, `"code" tier has models`);

// ── Test 2: Fallback chains are resolved ─────────────────────────────
console.log(`\n${COLORS.BOLD}Test 2: Fallback chains resolved correctly${COLORS.RESET}`);

// "plan" falls back to "fast", so plan should include fast's models
if (tiers.plan && tiers.fast) {
    const planModels = tiers.plan;
    const fastModels = tiers.fast;
    const planOnlyModels = planModels.filter(m => !fastModels.includes(m));
    const planFallbackModels = planModels.filter(m => fastModels.includes(m));
    assert(planFallbackModels.length > 0, `"plan" tier includes fallback models from "fast" (found ${planFallbackModels.length})`);
    if (planOnlyModels.length > 0 && planFallbackModels.length > 0) {
        const lastPlanOnly = planModels.lastIndexOf(planOnlyModels[planOnlyModels.length - 1]);
        const firstFallback = planModels.indexOf(planFallbackModels[0]);
        assert(lastPlanOnly < firstFallback, `plan-only models come before fallback models`);
    }
}

// "code" falls back to "deep" (via code-paid if non-empty)
if (tiers.code && tiers.deep) {
    const codeModels = tiers.code;
    const deepModels = tiers.deep;
    const codeHasDeepFallback = deepModels.some(m => codeModels.includes(m));
    assert(codeHasDeepFallback, `"code" tier includes fallback models from "deep" chain`);
}

// "ultra" falls back to "deep"
if (tiers.ultra && tiers.deep) {
    const ultraModels = tiers.ultra;
    const deepModels = tiers.deep;
    const ultraHasDeepFallback = deepModels.some(m => ultraModels.includes(m));
    assert(ultraHasDeepFallback, `"ultra" tier includes fallback models from "deep"`);
}

// ── Test 3: No duplicate models in resolved tiers ────────────────────
console.log(`\n${COLORS.BOLD}Test 3: No duplicate models in any tier${COLORS.RESET}`);
for (const name of tierNames) {
    const models = tiers[name];
    const unique = new Set(models);
    assert(unique.size === models.length, `"${name}" tier has no duplicates (${models.length} models, ${unique.size} unique)`);
}

// ── Test 4: getPrioritizedModels() returns tier models ───────────────
console.log(`\n${COLORS.BOLD}Test 4: getPrioritizedModels() returns correct models for each tier${COLORS.RESET}`);
for (const name of tierNames) {
    const prioritized = getPrioritizedModels(name);
    assertDeepEqual(prioritized, tiers[name], `getPrioritizedModels("${name}") matches resolved tier`);
}

// ── Test 5: Cascade tries every model via invoker ────────────────────
console.log(`\n${COLORS.BOLD}Test 5: Invoker cascade exhausts every model in tier${COLORS.RESET}`);

// Install test interceptor: record every model tried, always fail
const callLog = [];
__setCallLLMWithModelForTests(async (modelName, history, prompt, options) => {
    callLog.push(modelName);
    throw new Error(`test-cascade: forced failure for ${modelName}`);
});

try {
    for (const tierName of tierNames) {
        const expectedModels = tiers[tierName];
        if (!expectedModels || expectedModels.length === 0) {
            console.log(`  ${COLORS.YELLOW}⚠${COLORS.RESET} "${tierName}" tier is empty, skipping cascade test`);
            continue;
        }

        callLog.length = 0; // reset

        try {
            await defaultLLMInvokerStrategy({
                prompt: 'test cascade prompt',
                tier: tierName,
            });
            // Should not reach here since our mock always throws
            assert(false, `"${tierName}" tier: expected all calls to fail`);
        } catch (err) {
            // Verify from callLog that every model was tried in order
            assertDeepEqual(
                callLog,
                expectedModels,
                `"${tierName}" tier: cascade tried all ${expectedModels.length} models in order`
            );

            // Also verify the error's modelsTried matches
            if (err.modelsTried) {
                assertDeepEqual(
                    err.modelsTried,
                    expectedModels,
                    `"${tierName}" tier: error.modelsTried matches expected`
                );
            }
        }
    }

    // ── Test 6: mode (legacy alias) maps to tier ─────────────────────
    console.log(`\n${COLORS.BOLD}Test 6: Backward compatibility — legacy mode alias maps to tier${COLORS.RESET}`);

    if (tiers.fast) {
        callLog.length = 0;
        try {
            await defaultLLMInvokerStrategy({ prompt: 'test compat', mode: 'fast' });
        } catch (err) {
            assertDeepEqual(callLog, tiers.fast, `legacy mode:"fast" cascades through tier "fast" models`);
        }
    }

    if (tiers.deep) {
        callLog.length = 0;
        try {
            await defaultLLMInvokerStrategy({ prompt: 'test compat', mode: 'deep' });
        } catch (err) {
            assertDeepEqual(callLog, tiers.deep, `legacy mode:"deep" cascades through tier "deep" models`);
        }
    }

    // ── Test 7: Specific model bypasses tier ─────────────────────────
    console.log(`\n${COLORS.BOLD}Test 7: Specific model name bypasses tier cascade${COLORS.RESET}`);
    const allModels = listModelsFromCache();
    const someModel = (allModels.fast[0] || allModels.deep[0])?.name;
    if (someModel) {
        callLog.length = 0;
        try {
            await defaultLLMInvokerStrategy({
                prompt: 'test specific model',
                model: someModel,
                tier: 'deep', // should be ignored when model is specified
            });
        } catch (err) {
            assert(callLog.length === 1, `specific model: only 1 call made (not full tier)`);
            assert(callLog[0] === someModel, `specific model: called "${someModel}"`);
        }
    }

    // ── Test 8: First success stops cascade ──────────────────────────
    console.log(`\n${COLORS.BOLD}Test 8: First successful model stops the cascade${COLORS.RESET}`);

    // Pick a tier with at least 2 models
    const multiTier = tierNames.find(t => tiers[t].length >= 2);
    if (multiTier) {
        const tierModels = tiers[multiTier];
        const successModel = tierModels[1]; // second model succeeds

        callLog.length = 0;
        __setCallLLMWithModelForTests(async (modelName, history, prompt, options) => {
            callLog.push(modelName);
            if (modelName === successModel) {
                return `success from ${modelName}`;
            }
            throw new Error(`test: forced failure for ${modelName}`);
        });

        try {
            const result = await defaultLLMInvokerStrategy({
                prompt: 'test early stop',
                tier: multiTier,
            });
            assert(callLog.length === 2, `"${multiTier}" tier: stopped after 2nd model (tried ${callLog.length})`);
            assert(callLog[0] === tierModels[0], `1st call was ${tierModels[0]}`);
            assert(callLog[1] === successModel, `2nd call was ${successModel} (success)`);
            assert(result.model === successModel, `result.model is ${successModel}`);
        } catch (err) {
            assert(false, `"${multiTier}" tier: unexpected error: ${err.message}`);
        }
    } else {
        console.log(`  ${COLORS.YELLOW}⚠${COLORS.RESET} no tier with ≥2 models to test early stop`);
    }

} finally {
    // Always restore real implementation
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
