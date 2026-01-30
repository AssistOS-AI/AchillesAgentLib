/**
 * Unit Tests for ConfirmationUtils
 *
 * Tests the core yes/no/cancel resolution utilities used by
 * ConversationalTskillController and ConfirmationHelper.
 */

import test from 'node:test';
import assert from 'node:assert';
import {
    isYesResponse,
    isNoResponse,
    isCancelResponse,
    resolveConfirmation,
} from '../../utils/ConfirmationUtils.mjs';

// ============= isYesResponse =============

test('isYesResponse recognises affirmative keywords', () => {
    const yesInputs = [
        'yes', 'y', 'accept', 'confirm', 'ok',
        'proceed', 'sure', 'go ahead', 'do it', 'affirmative',
    ];
    for (const input of yesInputs) {
        assert.strictEqual(isYesResponse(input), true, `"${input}" should be yes`);
    }
});

test('isYesResponse is case-insensitive', () => {
    assert.strictEqual(isYesResponse('YES'), true);
    assert.strictEqual(isYesResponse('Yes'), true);
    assert.strictEqual(isYesResponse('CONFIRM'), true);
    assert.strictEqual(isYesResponse('Go Ahead'), true);
});

test('isYesResponse trims whitespace', () => {
    assert.strictEqual(isYesResponse('  yes  '), true);
    assert.strictEqual(isYesResponse('\tconfirm\n'), true);
});

test('isYesResponse rejects non-yes inputs', () => {
    assert.strictEqual(isYesResponse('no'), false);
    assert.strictEqual(isYesResponse('maybe'), false);
    assert.strictEqual(isYesResponse('yes please'), false); // multi-word fails exact match
    assert.strictEqual(isYesResponse('yess'), false);
    assert.strictEqual(isYesResponse('list equipment'), false);
});

test('isYesResponse handles null and empty', () => {
    assert.strictEqual(isYesResponse(null), false);
    assert.strictEqual(isYesResponse(undefined), false);
    assert.strictEqual(isYesResponse(''), false);
});

// ============= isNoResponse =============

test('isNoResponse recognises negative keywords', () => {
    const noInputs = [
        'no', 'n', 'cancel', 'stop', 'abort',
        'reject', 'decline', 'nevermind', 'never mind',
    ];
    for (const input of noInputs) {
        assert.strictEqual(isNoResponse(input), true, `"${input}" should be no`);
    }
});

test('isNoResponse is case-insensitive', () => {
    assert.strictEqual(isNoResponse('NO'), true);
    assert.strictEqual(isNoResponse('Cancel'), true);
    assert.strictEqual(isNoResponse('ABORT'), true);
    assert.strictEqual(isNoResponse('Never Mind'), true);
});

test('isNoResponse trims whitespace', () => {
    assert.strictEqual(isNoResponse('  no  '), true);
    assert.strictEqual(isNoResponse('\tcancel\n'), true);
});

test('isNoResponse rejects non-no inputs', () => {
    assert.strictEqual(isNoResponse('yes'), false);
    assert.strictEqual(isNoResponse('maybe'), false);
    assert.strictEqual(isNoResponse('no way'), false); // multi-word fails exact match
    assert.strictEqual(isNoResponse('noo'), false);
    assert.strictEqual(isNoResponse('list equipment'), false);
});

test('isNoResponse handles null and empty', () => {
    assert.strictEqual(isNoResponse(null), false);
    assert.strictEqual(isNoResponse(undefined), false);
    assert.strictEqual(isNoResponse(''), false);
});

// ============= isCancelResponse =============

test('isCancelResponse recognises cancel keywords', () => {
    const cancelInputs = ['cancel', 'abort', 'stop', 'quit', 'exit', 'nevermind', 'never mind'];
    for (const input of cancelInputs) {
        assert.strictEqual(isCancelResponse(input), true, `"${input}" should be cancel`);
    }
});

test('isCancelResponse is case-insensitive', () => {
    assert.strictEqual(isCancelResponse('CANCEL'), true);
    assert.strictEqual(isCancelResponse('Quit'), true);
    assert.strictEqual(isCancelResponse('EXIT'), true);
});

test('isCancelResponse rejects non-cancel inputs', () => {
    assert.strictEqual(isCancelResponse('yes'), false);
    assert.strictEqual(isCancelResponse('no'), false);
    assert.strictEqual(isCancelResponse('help'), false);
    assert.strictEqual(isCancelResponse('cancelled'), false);
});

test('isCancelResponse handles null and empty', () => {
    assert.strictEqual(isCancelResponse(null), false);
    assert.strictEqual(isCancelResponse(undefined), false);
    assert.strictEqual(isCancelResponse(''), false);
});

// ============= resolveConfirmation (without LLM) =============

test('resolveConfirmation returns yes for affirmative input', async () => {
    assert.strictEqual(await resolveConfirmation('yes'), 'yes');
    assert.strictEqual(await resolveConfirmation('confirm'), 'yes');
    assert.strictEqual(await resolveConfirmation('OK'), 'yes');
});

test('resolveConfirmation returns no for negative input', async () => {
    assert.strictEqual(await resolveConfirmation('no'), 'no');
    assert.strictEqual(await resolveConfirmation('cancel'), 'no');
    assert.strictEqual(await resolveConfirmation('ABORT'), 'no');
});

test('resolveConfirmation returns unclear for empty input', async () => {
    assert.strictEqual(await resolveConfirmation(''), 'unclear');
    assert.strictEqual(await resolveConfirmation(null), 'unclear');
    assert.strictEqual(await resolveConfirmation(undefined), 'unclear');
});

test('resolveConfirmation returns unclear for ambiguous input without LLM', async () => {
    assert.strictEqual(await resolveConfirmation('maybe'), 'unclear');
    assert.strictEqual(await resolveConfirmation('I think so'), 'unclear');
    assert.strictEqual(await resolveConfirmation('nah'), 'unclear');
    assert.strictEqual(await resolveConfirmation('list equipment'), 'unclear');
});

// ============= resolveConfirmation (with mock LLM) =============

test('resolveConfirmation delegates to LLM for ambiguous input', async () => {
    const mockLLM = {
        resolveConfirmation: async (_prompt, _options) => ({
            decision: 'yes',
            confidence: 0.9,
        }),
    };

    const result = await resolveConfirmation('sure thing', mockLLM);
    assert.strictEqual(result, 'yes');
});

test('resolveConfirmation returns LLM no decision', async () => {
    const mockLLM = {
        resolveConfirmation: async () => ({
            decision: 'no',
            confidence: 0.85,
        }),
    };

    const result = await resolveConfirmation('nah forget it', mockLLM);
    assert.strictEqual(result, 'no');
});

test('resolveConfirmation returns unclear when LLM returns unknown decision', async () => {
    const mockLLM = {
        resolveConfirmation: async () => ({
            decision: 'unclear',
            confidence: 0.3,
        }),
    };

    const result = await resolveConfirmation('maybe later', mockLLM);
    assert.strictEqual(result, 'unclear');
});

test('resolveConfirmation returns unclear when LLM throws', async () => {
    const mockLLM = {
        resolveConfirmation: async () => {
            throw new Error('LLM unavailable');
        },
    };

    const result = await resolveConfirmation('sure thing', mockLLM);
    assert.strictEqual(result, 'unclear');
});

test('resolveConfirmation skips LLM if regex matches first', async () => {
    let llmCalled = false;
    const mockLLM = {
        resolveConfirmation: async () => {
            llmCalled = true;
            return { decision: 'no' };
        },
    };

    // "yes" matches regex — LLM should NOT be called
    const result = await resolveConfirmation('yes', mockLLM);
    assert.strictEqual(result, 'yes');
    assert.strictEqual(llmCalled, false, 'LLM should not be called when regex matches');
});

test('resolveConfirmation passes actionContext to LLM', async () => {
    let receivedOptions = null;
    const mockLLM = {
        resolveConfirmation: async (_prompt, options) => {
            receivedOptions = options;
            return { decision: 'yes' };
        },
    };

    // Use an ambiguous phrase that won't match the regex
    await resolveConfirmation('sounds good to me', mockLLM, {
        actionContext: 'confirming deletion',
    });
    assert.strictEqual(receivedOptions?.actionContext, 'confirming deletion');
});

test('resolveConfirmation uses default actionContext', async () => {
    let receivedOptions = null;
    const mockLLM = {
        resolveConfirmation: async (_prompt, options) => {
            receivedOptions = options;
            return { decision: 'yes' };
        },
    };

    // Use an ambiguous phrase that won't match the regex
    await resolveConfirmation('I guess so', mockLLM);
    assert.strictEqual(receivedOptions?.actionContext, 'confirming an operation');
});

test('resolveConfirmation skips LLM if agent has no resolveConfirmation', async () => {
    const mockLLM = { complete: async () => 'text' }; // no resolveConfirmation

    const result = await resolveConfirmation('maybe', mockLLM);
    assert.strictEqual(result, 'unclear');
});

console.log('ConfirmationUtils tests completed');
