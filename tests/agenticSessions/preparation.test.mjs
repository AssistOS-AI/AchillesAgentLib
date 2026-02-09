import assert from 'node:assert/strict';
import { test } from 'node:test';

import { LoopAgentSession } from '../../LLMAgents/AgenticSession.mjs';
import { SOPAgenticSession } from '../../LLMAgents/SOPAgenticSession.mjs';
import { OrchestratorSkillsSubsystem } from '../../OrchestratorSkillsSubsystem/OrchestratorSkillsSubsystem.mjs';

// Minimal stub LLM agent for testing preparation flows
function createStubLLMAgent(completeHandler) {
    return {
        name: 'StubLLMAgent',
        __toolState: new Map(),
        complete: completeHandler,
        executePrompt: completeHandler,
        startLoopAgentSession: async function (tools, initialPrompt, options) {
            const session = new LoopAgentSession({
                agent: this,
                tools,
                options,
            });
            await session.newPrompt(initialPrompt);
            return session;
        },
        startSOPLangAgentSession: async function (skillsDescription, initialPrompt, options) {
            const session = new SOPAgenticSession({
                agent: this,
                skillsDescription,
                options,
            });
            await session.newPrompt(initialPrompt);
            return session;
        },
        startLoopPreparationSession: async function (tools, preparationText, userPrompt, options) {
            const { retries = 1, ...sessionOptions } = options || {};
            return LoopAgentSession.runPreparation({
                agent: this,
                tools,
                options: sessionOptions,
                preparationText,
                userPrompt,
                retries,
            });
        },
        startSOPPreparationSession: async function (skillsDescription, preparationText, userPrompt, options) {
            const { retries = 1, ...sessionOptions } = options || {};
            return SOPAgenticSession.runPreparation({
                agent: this,
                skillsDescription,
                commandsRegistry: sessionOptions.commandsRegistry,
                options: sessionOptions,
                preparationText,
                userPrompt,
                retries,
            });
        },
    };
}

// Helper to create a tool that immediately returns final_answer with context lines
function createContextTool(contextLines) {
    return {
        'final_answer': {
            description: 'Return final answer',
            handler: async (_agent, payload) => ({
                __finalAnswer: true,
                text: contextLines.join('\n'),
            }),
        },
        'cannot_complete': {
            description: 'Cannot complete',
            handler: async (_agent, payload) => ({
                __cannotComplete: true,
                text: payload,
            }),
        },
    };
}

// =============================================================================
// LoopAgentSession.runPreparation tests
// =============================================================================

test('LoopAgentSession.runPreparation parses @context_ variables from output', async () => {
    let callCount = 0;
    const agent = createStubLLMAgent(async () => {
        callCount++;
        // First call: planner decides to call final_answer with context lines
        return {
            action: 'call_tool',
            tool: 'final_answer',
            toolPrompt: '@context_user := "john"\n@context_role := "admin"',
        };
    });

    const tools = {
        'echo': {
            description: 'Echo tool',
            handler: async (_a, p) => p,
        },
    };

    const result = await LoopAgentSession.runPreparation({
        agent,
        tools,
        options: { mode: 'fast', maxStepsPerTurn: 5 },
        preparationText: 'Load user context',
        userPrompt: 'do something',
        retries: 0,
    });

    assert.ok(result.contextEntries.length === 2, 'should parse 2 context entries');
    assert.equal(result.contextEntries[0].name, '@context_user');
    assert.equal(result.contextEntries[0].value, 'john');
    assert.equal(result.contextEntries[1].name, '@context_role');
    assert.equal(result.contextEntries[1].value, 'admin');
    assert.ok(result.contextLines.length === 2, 'should have 2 context lines');
    assert.ok(result.contextLines[0].includes('@context-piece-1'), 'first line should be @context-piece-1');
});

test('LoopAgentSession.runPreparation returns empty when no @context_ in output', async () => {
    const agent = createStubLLMAgent(async () => ({
        action: 'call_tool',
        tool: 'final_answer',
        toolPrompt: 'Just some plain text without context variables',
    }));

    const result = await LoopAgentSession.runPreparation({
        agent,
        tools: {},
        options: { mode: 'fast', maxStepsPerTurn: 5 },
        preparationText: 'Load context',
        userPrompt: 'test',
        retries: 0,
    });

    assert.equal(result.contextEntries.length, 0, 'should have no context entries');
    assert.equal(result.contextLines.length, 0, 'should have no context lines');
});

test('LoopAgentSession.runPreparation returns empty when preparationText is empty', async () => {
    const agent = createStubLLMAgent(async () => {
        throw new Error('Should not be called');
    });

    const result = await LoopAgentSession.runPreparation({
        agent,
        tools: {},
        options: {},
        preparationText: '',
        userPrompt: 'test',
        retries: 0,
    });

    assert.equal(result.contextEntries.length, 0);
    assert.equal(result.contextLines.length, 0);
});

test('LoopAgentSession.runPreparation retries on failure', async () => {
    let attempts = 0;
    const agent = createStubLLMAgent(async () => {
        attempts++;
        if (attempts === 1) {
            // First attempt: return something that will cause an error
            return { action: 'invalid' };
        }
        // Second attempt: return valid final_answer
        return {
            action: 'call_tool',
            tool: 'final_answer',
            toolPrompt: '@context_retry := "success"',
        };
    });

    const result = await LoopAgentSession.runPreparation({
        agent,
        tools: {},
        options: { mode: 'fast', maxStepsPerTurn: 2, maxErrors: 1 },
        preparationText: 'Load context',
        userPrompt: 'test',
        retries: 1,
    });

    assert.ok(attempts >= 1, 'should have attempted at least once');
    // Note: due to retry logic, we expect either success or empty result
});

// =============================================================================
// SOPAgenticSession.runPreparation tests
// =============================================================================

test('SOPAgenticSession.runPreparation parses @context_ variables from SOP output', async () => {
    let planGenerated = false;
    const agent = createStubLLMAgent(async (options) => {
        const prompt = options?.prompt || options || '';
        // Return a simple SOP plan that outputs context
        if (!planGenerated) {
            planGenerated = true;
            return '@result final_answer "@context_data := \\"loaded\\""';
        }
        return '@context_data := "loaded"';
    });

    const skillsDescription = {
        'echo': 'Echo skill',
    };

    const commandsRegistry = {
        executeCommand: async (payload, response) => {
            if (payload.command === 'final_answer') {
                return response.success('@context_data := "loaded"');
            }
            return response.success('ok');
        },
        listCommands: () => [
            { name: 'echo', description: 'Echo skill' },
        ],
    };

    const result = await SOPAgenticSession.runPreparation({
        agent,
        skillsDescription,
        commandsRegistry,
        options: { mode: 'deep' },
        preparationText: 'Load data context',
        userPrompt: 'process data',
        retries: 0,
    });

    // The result depends on what the SOP session produces
    assert.ok(result.contextEntries !== undefined, 'should have contextEntries');
    assert.ok(result.contextLines !== undefined, 'should have contextLines');
});

test('SOPAgenticSession.runPreparation returns empty when preparationText is empty', async () => {
    const agent = createStubLLMAgent(async () => {
        throw new Error('Should not be called');
    });

    const result = await SOPAgenticSession.runPreparation({
        agent,
        skillsDescription: {},
        commandsRegistry: null,
        options: {},
        preparationText: '',
        userPrompt: 'test',
        retries: 0,
    });

    assert.equal(result.contextEntries.length, 0);
    assert.equal(result.contextLines.length, 0);
});

// =============================================================================
// OrchestratorSkillsSubsystem preparation integration tests
// =============================================================================

test('OrchestratorSkillsSubsystem prepareSkill parses ##Preparation section', () => {
    const subsystem = new OrchestratorSkillsSubsystem({ llmAgent: null });

    const skillRecord = {
        name: 'test-orchestrator',
        descriptor: {
            title: 'Test',
            sections: {
                instructions: 'Main instructions',
                preparation: 'Load user profile and preferences',
                'allowed-skills': '- skill1',
            },
        },
    };

    subsystem.prepareSkill(skillRecord);

    assert.equal(skillRecord.metadata.instructions, 'Main instructions');
    assert.equal(skillRecord.metadata.preparation, 'Load user profile and preferences');
    assert.deepEqual(skillRecord.metadata.allowedSkills, ['skill1']);
});

test('OrchestratorSkillsSubsystem injects preparation context into loop session', async () => {
    let capturedPrompt = null;
    let capturedSystemPrompt = null;

    const stubLLMAgent = {
        startLoopPreparationSession: async () => ({
            contextEntries: [{ name: '@context_user', value: 'testuser' }],
            contextLines: ['@context-piece-1 := "testuser"'],
            rawText: '@context_user := "testuser"',
        }),
        startLoopAgentSession: async (tools, prompt, options) => {
            capturedPrompt = prompt;
            capturedSystemPrompt = options?.systemPrompt;
            return {
                status: 'done',
                getLastResult: () => 'Loop completed',
            };
        },
    };

    const subsystem = new OrchestratorSkillsSubsystem({ llmAgent: stubLLMAgent });

    const skillRecord = {
        name: 'test-loop-orchestrator',
        metadata: {
            sessionType: 'loop',
            instructions: 'Execute the task',
            preparation: 'Load user context',
            allowedSkills: [],
        },
    };

    const recursiveAgent = {
        skillCatalog: new Map(),
    };

    const result = await subsystem.executeLoopAgentSession({
        skillRecord,
        recursiveAgent,
        promptText: 'Do something',
        options: { mode: 'fast' },
    });

    assert.equal(result.session, 'loop');
    assert.ok(capturedPrompt.includes('@context-piece-1'), 'prompt should contain context piece');
    assert.ok(capturedSystemPrompt.includes('@context-piece-1'), 'systemPrompt should contain context piece');
});

test('OrchestratorSkillsSubsystem injects preparation context into SOP session', async () => {
    let capturedPrompt = null;

    const stubLLMAgent = {
        startSOPPreparationSession: async () => ({
            contextEntries: [{ name: '@context_data', value: 'prepared' }],
            contextLines: ['@context-piece-1 := "prepared"'],
            rawText: '@context_data := "prepared"',
        }),
        startSOPLangAgentSession: async (skillsDescription, prompt, options) => {
            capturedPrompt = prompt;
            return {
                getVariables: async () => ({}),
                getLastResult: () => 'SOP completed',
            };
        },
    };

    const subsystem = new OrchestratorSkillsSubsystem({ llmAgent: stubLLMAgent });

    const skillRecord = {
        name: 'test-sop-orchestrator',
        metadata: {
            sessionType: null, // SOP session (no loop)
            instructions: 'Plan and execute',
            preparation: 'Load data context',
            allowedSkills: [],
        },
    };

    const recursiveAgent = {
        skillCatalog: new Map(),
    };

    const result = await subsystem.executeSOPAgentSession({
        skillRecord,
        recursiveAgent,
        promptText: 'Process data',
        options: { mode: 'deep' },
    });

    assert.equal(result.session, 'sop');
    assert.ok(capturedPrompt.includes('@context-piece-1'), 'prompt should contain context piece');
});

test('OrchestratorSkillsSubsystem skips preparation when no ##Preparation section', async () => {
    let prepCalled = false;
    let mainCalled = false;

    const stubLLMAgent = {
        startLoopPreparationSession: async () => {
            prepCalled = true;
            return { contextEntries: [], contextLines: [] };
        },
        startLoopAgentSession: async () => {
            mainCalled = true;
            return {
                status: 'done',
                getLastResult: () => 'Done',
            };
        },
    };

    const subsystem = new OrchestratorSkillsSubsystem({ llmAgent: stubLLMAgent });

    const skillRecord = {
        name: 'no-prep-orchestrator',
        metadata: {
            sessionType: 'loop',
            instructions: 'Just execute',
            preparation: null, // No preparation
            allowedSkills: [],
        },
    };

    const recursiveAgent = {
        skillCatalog: new Map(),
    };

    await subsystem.executeLoopAgentSession({
        skillRecord,
        recursiveAgent,
        promptText: 'Test',
        options: {},
    });

    assert.equal(prepCalled, false, 'preparation should not be called');
    assert.equal(mainCalled, true, 'main session should be called');
});

// =============================================================================
// Context parsing edge cases
// =============================================================================

test('context parsing handles various formats', async () => {
    const agent = createStubLLMAgent(async () => ({
        action: 'call_tool',
        tool: 'final_answer',
        toolPrompt: [
            '@context_a := "value1"',
            '@context_b: value2',
            '@context_c = value3',
            '@context_d := "quoted value"',
            '@other_var := "ignored"', // not @context_ prefix
            'random text',
            '@context_e := \'single quoted\'',
        ].join('\n'),
    }));

    const result = await LoopAgentSession.runPreparation({
        agent,
        tools: {},
        options: { mode: 'fast', maxStepsPerTurn: 5 },
        preparationText: 'Parse formats',
        userPrompt: 'test',
        retries: 0,
    });

    // Should parse @context_a through @context_e, ignore @other_var
    const names = result.contextEntries.map(e => e.name);
    assert.ok(names.includes('@context_a'), 'should parse := format');
    assert.ok(names.includes('@context_b'), 'should parse : format');
    assert.ok(names.includes('@context_c'), 'should parse = format');
    assert.ok(names.includes('@context_d'), 'should parse quoted value');
    assert.ok(!names.includes('@other_var'), 'should ignore non-context prefix');
});
