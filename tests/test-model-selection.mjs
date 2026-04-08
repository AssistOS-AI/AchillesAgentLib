#!/usr/bin/env node
/**
 * Test: model selector resolution for defaults.
 *
 * Usage: node tests/test-model-selection.mjs
 */

const COLORS = {
    RESET: '\x1b[0m',
    RED: '\x1b[31m',
    GREEN: '\x1b[32m',
    CYAN: '\x1b[36m',
    BOLD: '\x1b[1m',
};

let passed = 0;
let failed = 0;

function assert(condition, message) {
    if (condition) {
        console.log(`  ${COLORS.GREEN}✓${COLORS.RESET} ${message}`);
        passed += 1;
        return;
    }
    console.log(`  ${COLORS.RED}✗${COLORS.RESET} ${message}`);
    failed += 1;
}

import {
    loadModelsConfiguration,
    resolveModelForInvocation,
    getPrioritizedModels,
    defaultLLMInvokerStrategy,
    callLLMWithModel,
    __setCallLLMWithModelForTests,
    __resetCallLLMWithModelForTests,
} from '../utils/LLMClient.mjs';

console.log(`${COLORS.BOLD}${COLORS.CYAN}Loading model configuration...${COLORS.RESET}`);
const config = await loadModelsConfiguration();

const planDefault = config.defaults?.get('plan') || null;

console.log(`\n${COLORS.BOLD}Test 1: LLM defaults include plan${COLORS.RESET}`);
assert(typeof planDefault === 'string' && planDefault.length > 0, `defaults.plan is set (${planDefault || 'missing'})`);

console.log(`\n${COLORS.BOLD}Test 2: model:"plan" resolves to defaults.plan${COLORS.RESET}`);
const planResolved = resolveModelForInvocation({ model: 'plan' });
assert(planResolved === planDefault, `resolveModelForInvocation({model:'plan'}) -> "${planResolved}"`);

console.log(`\n${COLORS.BOLD}Test 3: no-args resolution stays valid${COLORS.RESET}`);
const defaultResolved = resolveModelForInvocation({});
assert(typeof defaultResolved === 'string' && defaultResolved.length > 0, `resolveModelForInvocation({}) -> "${defaultResolved}"`);

console.log(`\n${COLORS.BOLD}Test 4: unknown model still passes through${COLORS.RESET}`);
const unknown = resolveModelForInvocation({ model: 'unknown-model-xyz' });
assert(unknown === 'unknown-model-xyz', 'unknown model remains pass-through');

console.log(`\n${COLORS.BOLD}Test 5: callLLMWithModel("plan") sends defaults.plan${COLORS.RESET}`);
const callLog = [];
__setCallLLMWithModelForTests(async (modelName, history, prompt, invocationOptions = {}) => {
    callLog.push({
        modelName,
        providerKey: invocationOptions.providerKey || null,
    });
    return `ok:${modelName}`;
});

try {
    callLog.length = 0;
    const output = await callLLMWithModel('plan', [], 'ping');
    assert(callLog.length === 1, `single call made (${callLog.length})`);
    assert(callLog[0]?.modelName === planDefault, `called with defaults.plan (${callLog[0]?.modelName})`);
    assert(typeof output === 'string' && output.startsWith('ok:'), `callLLMWithModel returned test output (${output})`);

    console.log(`\n${COLORS.BOLD}Test 6: invoker with model:"plan" calls one resolved model${COLORS.RESET}`);
    callLog.length = 0;
    const invocationResult = await defaultLLMInvokerStrategy({
        prompt: 'test plan routing',
        model: 'plan',
    });
    assert(callLog.length === 1, `invoker made one call (${callLog.length})`);
    assert(callLog[0]?.modelName === planDefault, `invoker used defaults.plan (${callLog[0]?.modelName})`);
    assert(callLog[0]?.providerKey === 'soul_gateway', `invoker inferred provider soul_gateway (${callLog[0]?.providerKey})`);
    assert(Array.isArray(invocationResult?.requestedTags), 'invoker result contains requestedTags array');
    assert(Array.isArray(invocationResult?.matchedTags), 'invoker result contains matchedTags array');
    assert(invocationResult?.requestedTags?.length === 0, `requestedTags empty for explicit model (${JSON.stringify(invocationResult?.requestedTags)})`);
    assert(invocationResult?.matchedTags?.length === 0, `matchedTags empty for explicit model (${JSON.stringify(invocationResult?.matchedTags)})`);

    const lastInvocation = defaultLLMInvokerStrategy.getLastInvocationDetails();
    assert(Array.isArray(lastInvocation?.requestedTags), 'last invocation includes requestedTags array');
    assert(Array.isArray(lastInvocation?.matchedTags), 'last invocation includes matchedTags array');
    assert(lastInvocation?.model === planDefault, `last invocation model stored (${lastInvocation?.model})`);

    console.log(`\n${COLORS.BOLD}Test 7: getPrioritizedModels("plan") starts with defaults.plan${COLORS.RESET}`);
    const prioritized = getPrioritizedModels('plan');
    assert(Array.isArray(prioritized), 'getPrioritizedModels returns array');
    assert(prioritized[0] === planDefault, `first prioritized model is defaults.plan (${prioritized[0]})`);
} finally {
    __resetCallLLMWithModelForTests();
}

console.log(`\n${COLORS.BOLD}${COLORS.CYAN}════════════════════════════════════${COLORS.RESET}`);
console.log(`  ${COLORS.GREEN}Passed: ${passed}${COLORS.RESET}`);
if (failed > 0) {
    console.log(`  ${COLORS.RED}Failed: ${failed}${COLORS.RESET}`);
}
console.log(`${COLORS.BOLD}${COLORS.CYAN}════════════════════════════════════${COLORS.RESET}`);

process.exit(failed > 0 ? 1 : 0);
