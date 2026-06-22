import assert from 'node:assert/strict';
import { test } from 'node:test';

import { LoopAgentSession } from '../../LLMAgents/LoopAgenticSession/LoopAgentSession.mjs';
import { SESSION_STATUS_AWAITING_INPUT } from '../../LLMAgents/constants.mjs';
import { parseHistoryCompressionMarkdown } from '../../LLMAgents/LoopAgenticSession/historyCompressionMarkdown.mjs';

function createStubAgent({ onComplete = null, onInterpretMessage = null } = {}) {
    return {
        name: 'StubLLMAgent',
        __toolState: new Map(),
        complete: async (options = {}) => {
            if (typeof onComplete === 'function') {
                return onComplete(options);
            }
            return compressionMarkdown({ summary: 'Compressed history.' });
        },
        interpretMessage: async (message, opts = {}) => {
            if (typeof onInterpretMessage === 'function') {
                return onInterpretMessage(message, opts);
            }
            return { intent: 'accept', confidence: 1 };
        },
    };
}

function createMinimalTools() {
    return {
        echo: {
            description: 'Echo tool',
            handler: async (_agent, payload) => payload,
        },
    };
}

function plannerMarkdownDecision({ tool, prompt, reason = 'test' }) {
    return [
        '## tool',
        tool,
        '',
        '## prompt',
        prompt,
        '',
        '## reason',
        reason,
    ].join('\n');
}

function compressionMarkdown({ summary, keepResultRefs = [] }) {
    return [
        '## summary',
        summary,
        '',
        '## keepResultRefs',
        ...keepResultRefs.map((ref) => `- ${ref}`),
    ].join('\n');
}

function buildLargeHistory(count = 30) {
    const history = [];
    for (let i = 0; i < count; i += 1) {
        history.push({ type: 'user', prompt: `User message ${i}: ${'x'.repeat(200)}` });
        history.push({
            type: 'tool',
            tool: 'echo',
            prompt: `Echo ${i}`,
            resultRef: `echo-res-${i}`,
        });
    }
    return history;
}

test('LoopAgentSession exposes conversation snapshot without tool results', () => {
    const agent = createStubAgent();
    const session = new LoopAgentSession({
        agent,
        tools: createMinimalTools(),
        options: {},
    });

    session.status = 'active';
    session.lastAnswer = 'Previous answer';
    session.history = [
        { type: 'user', prompt: 'Show leads' },
        { type: 'final_answer', answer: 'Lead list' },
    ];
    session.toolVars.set('admin-flow-res-1', { result: 'Lead list' });

    const snapshot = session.getConversationSnapshot();

    assert.equal(snapshot.type, 'loop');
    assert.equal(snapshot.status, 'active');
    assert.equal(snapshot.lastAnswer, 'Previous answer');
    assert.deepEqual(snapshot.history, session.history);
    assert.equal(Object.prototype.hasOwnProperty.call(snapshot, 'toolResults'), false);

    snapshot.history[0].prompt = 'mutated';
    assert.equal(session.history[0].prompt, 'Show leads');
});

test('LoopAgentSession emits planner tool reason before tool execution', async () => {
    const events = [];
    let plannerCallCount = 0;
    const agent = createStubAgent({
        onComplete: async (options = {}) => {
            if (options?.context?.intent !== 'agentic-session-planner') {
                return compressionMarkdown({ summary: 'Compressed history.' });
            }
            plannerCallCount += 1;
            if (plannerCallCount === 1) {
                return plannerMarkdownDecision({
                    tool: 'echo',
                    prompt: 'hello',
                    reason: 'Read data before answering',
                });
            }
            return plannerMarkdownDecision({
                tool: 'final_answer',
                prompt: 'Done',
                reason: 'Finish the answer',
            });
        },
    });

    const session = new LoopAgentSession({
        agent,
        tools: {
            echo: {
                description: 'Echo tool',
                handler: async (_agent, payload) => {
                    events.push({ type: 'tool', payload });
                    return payload;
                },
            },
        },
        options: {
            supervisor: {
                async approve() { return 'approve'; },
                getOutputWriter() {
                    return {
                        write: async (message) => {
                            if (!message || typeof message !== 'object') {
                                return;
                            }
                            events.push({ type: 'progress', message });
                        },
                    };
                },
            },
        },
    });

    await session.newPrompt('Do work');

    assert.equal(events.length, 2);
    assert.equal(events[0].type, 'progress');
    assert.deepEqual(events[0].message, {
        type: 'tool_reason',
        tool: 'echo',
        reason: 'Read data before answering',
        stepIndex: 0,
    });
    assert.deepEqual(events[1], { type: 'tool', payload: 'hello' });
});

test('parseHistoryCompressionMarkdown parses summary and keepResultRefs', () => {
    const parsed = parseHistoryCompressionMarkdown([
        '## summary',
        'User asked for a report.',
        'Tools gathered data.',
        '',
        '## keepResultRefs',
        '- echo-res-1',
        '2. shell-res-2',
        'plain-res-3',
    ].join('\n'));

    assert.deepEqual(parsed, {
        summary: 'User asked for a report.\nTools gathered data.',
        keepResultRefs: ['echo-res-1', 'shell-res-2', 'plain-res-3'],
    });
});

test('parseHistoryCompressionMarkdown allows missing keepResultRefs', () => {
    const parsed = parseHistoryCompressionMarkdown([
        '# SUMMARY',
        'Only durable context.',
    ].join('\n'));

    assert.deepEqual(parsed, {
        summary: 'Only durable context.',
        keepResultRefs: [],
    });
});

test('parseHistoryCompressionMarkdown rejects missing summary and legacy JSON', () => {
    assert.equal(parseHistoryCompressionMarkdown('{"summary":"legacy","keepResultRefs":[]}'), null);
    assert.equal(parseHistoryCompressionMarkdown('## keepResultRefs\n- echo-res-1'), null);
    assert.equal(parseHistoryCompressionMarkdown({ summary: 'not markdown' }), null);
});

// =============================================================================
// History Compression Tests
// =============================================================================

test('compresses history when estimated tokens exceed threshold', async () => {
    let compressionCallCount = 0;
    let plannerCallCount = 0;

    const agent = createStubAgent({
        onComplete: async (options) => {
            const intent = options?.context?.intent || '';
            if (intent === 'agentic-session-history-compression') {
                compressionCallCount += 1;
                return compressionMarkdown({
                    summary: 'User asked for a report. Tools gathered data successfully.',
                });
            }
            if (intent === 'agentic-session-planner') {
                plannerCallCount += 1;
                return plannerMarkdownDecision({ tool: 'final_answer', prompt: 'Done' });
            }
            return plannerMarkdownDecision({ tool: 'final_answer', prompt: 'fallback' });
        },
    });

    const tools = createMinimalTools();
    const session = new LoopAgentSession({
        agent,
        tools,
        options: {
            maxStepsPerTurn: 5,
            maxErrors: 3,
            historyCompressionEnabled: true,
            historyCompressionThresholdTokens: 100,
            historyCompressionKeepRecentEntries: 4,
            historyCompressionMaxSummaryTokens: 500,
        },
    });

    session.history = buildLargeHistory(20);
    const historyLengthBefore = session.history.length;

    const result = await session.newPrompt('Show me the report');

    assert.equal(compressionCallCount, 1, 'compression should be called once');
    assert.ok(plannerCallCount >= 1, 'planner should be called at least once');
    assert.ok(result !== null && result !== undefined, 'should return a result');

    const summaryEntries = session.history.filter((h) => h.type === 'history_summary');
    assert.equal(summaryEntries.length, 1, 'should have exactly one summary entry');
    assert.ok(summaryEntries[0].summary.includes('report'), 'summary should contain key context');
    assert.ok(summaryEntries[0].compressedFromCount > 0, 'should track compressed entry count');
    assert.ok(typeof summaryEntries[0].compressedAt === 'string', 'should have timestamp');

    const summaryIndex = session.history.findIndex((h) => h.type === 'history_summary');
    assert.ok(summaryIndex === 0, 'summary should be the first entry');
    assert.ok(session.history.length < historyLengthBefore, 'history should be shorter after compression');
});

test('does not compress history when below threshold', async () => {
    let compressionCallCount = 0;

    const agent = createStubAgent({
        onComplete: async (options) => {
            const intent = options?.context?.intent || '';
            if (intent === 'agentic-session-history-compression') {
                compressionCallCount += 1;
                return compressionMarkdown({ summary: 'should not happen' });
            }
            return plannerMarkdownDecision({ tool: 'final_answer', prompt: 'Done' });
        },
    });

    const tools = createMinimalTools();
    const session = new LoopAgentSession({
        agent,
        tools,
        options: {
            maxStepsPerTurn: 5,
            maxErrors: 3,
            historyCompressionEnabled: true,
            historyCompressionThresholdTokens: 50000,
            historyCompressionKeepRecentEntries: 8,
        },
    });

    session.history = [
        { type: 'user', prompt: 'hello' },
        { type: 'tool', tool: 'echo', prompt: 'echo', resultRef: 'echo-res-1' },
    ];

    await session.newPrompt('second prompt');

    assert.equal(compressionCallCount, 0, 'compression should not be called when below threshold');
    const summaryEntries = session.history.filter((h) => h.type === 'history_summary');
    assert.equal(summaryEntries.length, 0, 'should have no summary entry');
});

test('skips compression when awaiting_input is pending', async () => {
    let compressionCallCount = 0;
    let plannerCallCount = 0;

    const agent = createStubAgent({
        onComplete: async (options) => {
            const intent = options?.context?.intent || '';
            if (intent === 'agentic-session-history-compression') {
                compressionCallCount += 1;
                return compressionMarkdown({ summary: 'should not happen' });
            }
            if (intent === 'agentic-session-planner') {
                plannerCallCount += 1;
            }
            return plannerMarkdownDecision({ tool: 'final_answer', prompt: 'Done' });
        },
    });

    const tools = createMinimalTools();
    const session = new LoopAgentSession({
        agent,
        tools,
        options: {
            maxStepsPerTurn: 5,
            maxErrors: 3,
            historyCompressionEnabled: true,
            historyCompressionThresholdTokens: 10,
            historyCompressionKeepRecentEntries: 4,
        },
    });

    session.history = [
        ...buildLargeHistory(15),
        { type: SESSION_STATUS_AWAITING_INPUT, tool: 'confirm_tool', answer: 'Confirm action?', step: 'confirmation' },
    ];

    await session.newPrompt('yes');

    assert.equal(compressionCallCount, 0, 'compression should be skipped when awaiting_input is pending');
    const awaitingEntries = session.history.filter((h) => h.type === SESSION_STATUS_AWAITING_INPUT);
    assert.ok(awaitingEntries.length >= 1, 'awaiting_input entry should be preserved');
});

test('continues gracefully when compression LLM call fails', async () => {
    let compressionCallCount = 0;

    const agent = createStubAgent({
        onComplete: async (options) => {
            const intent = options?.context?.intent || '';
            if (intent === 'agentic-session-history-compression') {
                compressionCallCount += 1;
                throw new Error('LLM compression service unavailable');
            }
            return plannerMarkdownDecision({ tool: 'final_answer', prompt: 'Done' });
        },
    });

    const tools = createMinimalTools();
    const session = new LoopAgentSession({
        agent,
        tools,
        options: {
            maxStepsPerTurn: 5,
            maxErrors: 3,
            historyCompressionEnabled: true,
            historyCompressionThresholdTokens: 100,
            historyCompressionKeepRecentEntries: 4,
        },
    });

    session.history = buildLargeHistory(20);
    const historyLengthBefore = session.history.length;

    const result = await session.newPrompt('Show me the report');

    assert.equal(compressionCallCount, 1, 'compression should have been attempted');
    assert.ok(result !== null && result !== undefined, 'session should still return a result');

    const summaryEntries = session.history.filter((h) => h.type === 'history_summary');
    assert.equal(summaryEntries.length, 0, 'no summary entry should be added on failure');
    assert.ok(session.history.length >= historyLengthBefore, 'history should not be truncated on failure');
});

test('preserves last N entries after compression', async () => {
    let compressionCallCount = 0;

    const agent = createStubAgent({
        onComplete: async (options) => {
            const intent = options?.context?.intent || '';
            if (intent === 'agentic-session-history-compression') {
                compressionCallCount += 1;
                return compressionMarkdown({ summary: 'Summary of old history.' });
            }
            return plannerMarkdownDecision({ tool: 'final_answer', prompt: 'Done' });
        },
    });

    const keepCount = 6;
    const tools = createMinimalTools();
    const session = new LoopAgentSession({
        agent,
        tools,
        options: {
            maxStepsPerTurn: 5,
            maxErrors: 3,
            historyCompressionEnabled: true,
            historyCompressionThresholdTokens: 100,
            historyCompressionKeepRecentEntries: keepCount,
        },
    });

    const markers = [];
    for (let i = 0; i < 20; i += 1) {
        const entry = { type: 'user', prompt: `msg-${i}` };
        session.history.push(entry);
        if (i >= 14) {
            markers.push(entry);
        }
    }

    await session.newPrompt('final prompt');

    assert.equal(compressionCallCount, 1, 'compression should run');

    const summaryIndex = session.history.findIndex((h) => h.type === 'history_summary');
    assert.ok(summaryIndex >= 0, 'summary entry should exist');

    for (const marker of markers) {
        const idx = session.history.indexOf(marker);
        assert.ok(idx > summaryIndex, `marker "${marker.prompt}" should appear after summary`);
    }
});

test('uses compression model override when provided', async () => {
    let capturedModel = null;

    const agent = createStubAgent({
        onComplete: async (options) => {
            const intent = options?.context?.intent || '';
            if (intent === 'agentic-session-history-compression') {
                capturedModel = options.model;
                return compressionMarkdown({ summary: 'Compressed.' });
            }
            return plannerMarkdownDecision({ tool: 'final_answer', prompt: 'Done' });
        },
    });

    const tools = createMinimalTools();
    const session = new LoopAgentSession({
        agent,
        tools,
        options: {
            maxStepsPerTurn: 5,
            maxErrors: 3,
            model: 'planner-model',
            historyCompressionEnabled: true,
            historyCompressionThresholdTokens: 100,
            historyCompressionKeepRecentEntries: 4,
            historyCompressionModel: 'compression-model-override',
        },
    });

    session.history = buildLargeHistory(15);

    await session.newPrompt('test');

    assert.equal(capturedModel, 'compression-model-override', 'should use compression model override');
});

test('falls back to planner model when compression model not set', async () => {
    let capturedModel = null;

    const agent = createStubAgent({
        onComplete: async (options) => {
            const intent = options?.context?.intent || '';
            if (intent === 'agentic-session-history-compression') {
                capturedModel = options.model;
                return compressionMarkdown({ summary: 'Compressed.' });
            }
            return plannerMarkdownDecision({ tool: 'final_answer', prompt: 'Done' });
        },
    });

    const tools = createMinimalTools();
    const session = new LoopAgentSession({
        agent,
        tools,
        options: {
            maxStepsPerTurn: 5,
            maxErrors: 3,
            model: 'planner-model-default',
            historyCompressionEnabled: true,
            historyCompressionThresholdTokens: 100,
            historyCompressionKeepRecentEntries: 4,
        },
    });

    session.history = buildLargeHistory(15);

    await session.newPrompt('test');

    assert.equal(capturedModel, 'planner-model-default', 'should fallback to planner model');
});

test('compression disabled when historyCompressionEnabled is false', async () => {
    let compressionCallCount = 0;

    const agent = createStubAgent({
        onComplete: async (options) => {
            const intent = options?.context?.intent || '';
            if (intent === 'agentic-session-history-compression') {
                compressionCallCount += 1;
                return compressionMarkdown({ summary: 'should not happen' });
            }
            return plannerMarkdownDecision({ tool: 'final_answer', prompt: 'Done' });
        },
    });

    const tools = createMinimalTools();
    const session = new LoopAgentSession({
        agent,
        tools,
        options: {
            maxStepsPerTurn: 5,
            maxErrors: 3,
            historyCompressionEnabled: false,
            historyCompressionThresholdTokens: 10,
        },
    });

    session.history = buildLargeHistory(20);

    await session.newPrompt('test');

    assert.equal(compressionCallCount, 0, 'compression should not run when disabled');
});

test('prunes toolVars and toolCalls based on keepResultRefs', async () => {
    const agent = createStubAgent({
        onComplete: async (options) => {
            const intent = options?.context?.intent || '';
            if (intent === 'agentic-session-history-compression') {
                return compressionMarkdown({
                    summary: 'Old history compressed.',
                    keepResultRefs: ['echo-res-0'],
                });
            }
            return plannerMarkdownDecision({ tool: 'final_answer', prompt: 'Done' });
        },
    });

    const tools = createMinimalTools();
    const session = new LoopAgentSession({
        agent,
        tools,
        options: {
            maxStepsPerTurn: 5,
            maxErrors: 3,
            historyCompressionEnabled: true,
            historyCompressionThresholdTokens: 100,
            historyCompressionKeepRecentEntries: 2,
        },
    });

    session.history = [
        ...buildLargeHistory(10),
        { type: 'user', prompt: 'msg-recent' },
        { type: 'tool', tool: 'echo', prompt: 'recent1', resultRef: 'recent-res-1' },
    ];

    for (let i = 0; i < 10; i += 1) {
        session.toolVars.set(`echo-res-${i}`, `value-${i}`);
        session.toolCalls.push({ tool: 'echo', prompt: `old${i}`, resultRef: `echo-res-${i}` });
    }
    session.toolVars.set('recent-res-1', 'recent-value');
    session.toolCalls.push({ tool: 'echo', prompt: 'recent1', resultRef: 'recent-res-1' });

    await session.newPrompt('final prompt');

    assert.ok(session.toolVars.has('echo-res-0'), 'kept ref should remain in toolVars');
    assert.ok(!session.toolVars.has('echo-res-1'), 'unreferenced old ref should be pruned from toolVars');
    assert.ok(session.toolVars.has('recent-res-1'), 'recent ref should remain in toolVars');

    const keptToolCalls = session.toolCalls.filter((tc) => tc.resultRef === 'echo-res-1');
    assert.equal(keptToolCalls.length, 0, 'unreferenced old toolCall should be pruned');

    const recentToolCalls = session.toolCalls.filter((tc) => tc.resultRef === 'recent-res-1');
    assert.equal(recentToolCalls.length, 1, 'recent toolCall should remain');
});

test('skips compression when markdown response is invalid', async () => {
    let compressionCallCount = 0;

    const agent = createStubAgent({
        onComplete: async (options) => {
            const intent = options?.context?.intent || '';
            if (intent === 'agentic-session-history-compression') {
                compressionCallCount += 1;
                return 'This is not valid compression markdown at all';
            }
            return plannerMarkdownDecision({ tool: 'final_answer', prompt: 'Done' });
        },
    });

    const tools = createMinimalTools();
    const session = new LoopAgentSession({
        agent,
        tools,
        options: {
            maxStepsPerTurn: 5,
            maxErrors: 3,
            historyCompressionEnabled: true,
            historyCompressionThresholdTokens: 100,
            historyCompressionKeepRecentEntries: 4,
        },
    });

    session.history = buildLargeHistory(20);
    const historyLengthBefore = session.history.length;

    const result = await session.newPrompt('Show me the report');

    assert.equal(compressionCallCount, 1, 'compression should have been attempted');
    assert.ok(result !== null && result !== undefined, 'session should still return a result');

    const summaryEntries = session.history.filter((h) => h.type === 'history_summary');
    assert.equal(summaryEntries.length, 0, 'no summary entry should be added on invalid markdown');
    assert.ok(session.history.length >= historyLengthBefore, 'history should not be truncated on invalid markdown');
});

test('compression prompt includes resultRef values from toolVars', async () => {
    let capturedPrompt = null;

    const agent = createStubAgent({
        onComplete: async (options) => {
            const intent = options?.context?.intent || '';
            if (intent === 'agentic-session-history-compression') {
                capturedPrompt = options.prompt;
                return compressionMarkdown({ summary: 'Compressed.' });
            }
            return plannerMarkdownDecision({ tool: 'final_answer', prompt: 'Done' });
        },
    });

    const tools = createMinimalTools();
    const session = new LoopAgentSession({
        agent,
        tools,
        options: {
            maxStepsPerTurn: 5,
            maxErrors: 3,
            historyCompressionEnabled: true,
            historyCompressionThresholdTokens: 100,
            historyCompressionKeepRecentEntries: 4,
        },
    });

    session.history = buildLargeHistory(20);

    session.toolVars.set('echo-res-0', 'important-data');
    session.toolVars.set('echo-res-1', 'other-data');

    await session.newPrompt('final prompt');

    assert.ok(capturedPrompt !== null, 'compression prompt should have been captured');
    assert.ok(capturedPrompt.includes('echo-res-0'), 'prompt should include resultRef identifiers');
    assert.ok(capturedPrompt.includes('important-data'), 'prompt should include result values from toolVars');
});
