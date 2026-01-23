import assert from 'node:assert/strict';
import { test } from 'node:test';

import { OrchestratorSkillsSubsystem } from '../../OrchestratorSkillsSubsystem/OrchestratorSkillsSubsystem.mjs';
import { StubLLMAgent } from '../helpers/stubLLMAgent.mjs';

test('resolveAllowedSkills allows all skill types except self when no allowlist', () => {
    const subsystem = new OrchestratorSkillsSubsystem({ llmAgent: new StubLLMAgent() });

    const skillRecord = {
        name: 'orchestrator-skill',
        metadata: { allowedSkills: [] },
    };

    const allSkills = [
        { name: 'cskill-1', type: 'cskill' },
        { name: 'mcp-1', type: 'mcp' },
        { name: 'dbtable-1', type: 'dbtable' },
        { name: 'claude-1', type: 'claude' },
        { name: 'interactive-1', type: 'interactive' },
        { name: 'code-gen-1', type: 'code-generation' },
        { name: 'orchestrator-skill', type: 'orchestrator' },
    ];

    const recursiveAgent = {
        skillCatalog: new Map(allSkills.map(skill => [skill.name, skill])),
    };

    const filtered = subsystem.resolveAllowedSkills(skillRecord, recursiveAgent);

    const allowedTypes = filtered.map(skill => skill.type);
    const expectedTypes = ['cskill', 'mcp', 'dbtable', 'claude', 'interactive', 'code-generation'];

    assert.equal(filtered.length, 6, 'should allow all skill types except self');
    assert.deepEqual(allowedTypes.sort(), expectedTypes.sort(), 'should allow all types except orchestrator self');
});

test('resolveAllowedSkills excludes self from allowed skills', () => {
    const subsystem = new OrchestratorSkillsSubsystem({ llmAgent: new StubLLMAgent() });

    const skillRecord = {
        name: 'self-orchestrator',
        metadata: { allowedSkills: [] },
    };

    const allSkills = [
        { name: 'self-orchestrator', type: 'cskill' },
        { name: 'other-skill', type: 'cskill' },
    ];

    const recursiveAgent = {
        skillCatalog: new Map(allSkills.map(skill => [skill.name, skill])),
    };

    const filtered = subsystem.resolveAllowedSkills(skillRecord, recursiveAgent);

    assert.equal(filtered.length, 1, 'should exclude self');
    assert.equal(filtered[0].name, 'other-skill', 'should only include other skills');
});

test('resolveAllowedSkills respects allowedSkills list when provided', () => {
    const subsystem = new OrchestratorSkillsSubsystem({ llmAgent: new StubLLMAgent() });

    const skillRecord = {
        name: 'orchestrator-skill',
        metadata: { allowedSkills: ['allowed-skill'] },
    };

    const allSkills = [
        { name: 'allowed-skill', shortName: 'allowed', type: 'cskill' },
        { name: 'not-allowed-skill', shortName: 'not-allowed', type: 'cskill' },
    ];

    const recursiveAgent = {
        skillCatalog: new Map(allSkills.map(skill => [skill.name, skill])),
    };

    const filtered = subsystem.resolveAllowedSkills(skillRecord, recursiveAgent);

    assert.equal(filtered.length, 1, 'should respect allowedSkills filter');
    assert.equal(filtered[0].name, 'allowed-skill', 'should only include allowed skill');
});

test('prepareSkill parses descriptor sections correctly', () => {
    const subsystem = new OrchestratorSkillsSubsystem({ llmAgent: new StubLLMAgent() });

    const skillRecord = {
        descriptor: {
            title: 'Test Orchestrator',
            summary: 'Test summary',
            body: 'Test body',
            sections: {
                instructions: 'Test instructions',
                'allowed-skills': '- skill1\n- skill2',
                intents: 'reporting: Generate reports\ndata: Fetch data',
                fallback: 'Intent: recovery\nRecover from errors\n\nAllowed Tools:\n- tool1',
                session: 'sop',
            },
        },
    };

    subsystem.prepareSkill(skillRecord);

    assert.equal(skillRecord.metadata.title, 'Test Orchestrator');
    assert.equal(skillRecord.metadata.summary, 'Test summary');
    assert.equal(skillRecord.metadata.body, 'Test body');
    assert.equal(skillRecord.metadata.instructions, 'Test instructions');
    assert.deepEqual(skillRecord.metadata.allowedSkills, ['skill1', 'skill2']);
    assert.equal(skillRecord.metadata.intents.length, 2);
    assert.equal(skillRecord.metadata.intents[0].id, 'reporting');
    assert.equal(skillRecord.metadata.intents[0].description, 'Generate reports');
    assert.equal(skillRecord.metadata.fallback.intent, 'recovery');
    assert.deepEqual(skillRecord.metadata.fallback.allowedTools, ['tool1']);
    assert.ok(skillRecord.metadata.fallback.instructions);
    assert.equal(skillRecord.metadata.sessionType, 'sop');
});

test('buildToolDescriptions generates descriptions from skill metadata', () => {
    const subsystem = new OrchestratorSkillsSubsystem({ llmAgent: new StubLLMAgent() });

    const allowedSkills = [
        {
            descriptor: {
                body: 'Primary description',
                summary: 'Summary description',
                title: 'Skill Title',
            },
            shortName: 'short',
            name: 'full-skill-name',
        },
        {
            descriptor: {
                summary: 'Only summary',
            },
            shortName: 'short2',
            name: 'skill2',
        },
    ];

    const descriptions = subsystem.buildToolDescriptions(allowedSkills);

    assert.equal(descriptions.short, 'Primary description');
    assert.equal(descriptions.short2, 'Only summary');
});

test('buildFallbackSkillRecord creates dynamic MCP skill descriptor', () => {
    const subsystem = new OrchestratorSkillsSubsystem({ llmAgent: new StubLLMAgent() });

    const skillRecord = {
        descriptor: { title: 'Original Skill' },
        name: 'original-skill',
        filePath: '/path/to/file',
        skillDir: '/path/to/dir',
        shortName: 'original',
    };

    const fallback = {
        intent: 'recovery',
        instructions: 'Recover from failure',
        allowedTools: ['tool1', 'tool2'],
    };

    const dynamicRecord = subsystem.buildFallbackSkillRecord({ skillRecord, fallback });

    assert.equal(dynamicRecord.name, 'original-skill-fallback-mcp');
    assert.equal(dynamicRecord.type, 'mcp');
    assert.equal(dynamicRecord.descriptor.title, 'Original Skill Fallback MCP');
    assert.equal(dynamicRecord.descriptor.summary, 'Recover from failure');
    assert.equal(dynamicRecord.descriptor.sections.instructions, 'Recover from failure');
    assert.equal(dynamicRecord.descriptor.sections['allowed-tools'], '- tool1\n- tool2');
    assert.ok(dynamicRecord.descriptor.sections['light-sop-lang'].includes('@prompt prompt'));
    assert.ok(dynamicRecord.descriptor.sections['light-sop-lang'].includes('@fallback_0 tool1 $prompt'));
    assert.ok(dynamicRecord.descriptor.sections['light-sop-lang'].includes('@fallback_1 tool2 $prompt'));
});

test('executeFallbackReact handles missing availableTools', async () => {
    const subsystem = new OrchestratorSkillsSubsystem({ llmAgent: new StubLLMAgent() });

    const skillRecord = {
        name: 'test-skill',
        descriptor: { title: 'Test Skill' },
    };

    const fallback = {
        intent: 'recovery',
        instructions: 'Recover gracefully',
        allowedTools: ['nonexistent-tool'],
    };

    const recursiveAgent = {
        ensureSubsystem: () => ({
            prepareSkill: () => {},
            executeSkillPrompt: async () => ({ result: { plan: [] } }),
        }),
    };

    const result = await subsystem.executeFallbackReact({
        skillRecord,
        fallback,
        recursiveAgent,
        promptText: 'Test prompt',
        options: {},
    });

    assert.ok(result, 'should return result even with no availableTools');
    assert.equal(result.intent, 'recovery');
    assert.equal(result.skill, 'test-skill-fallback-mcp');
    assert.equal(result.fallback, true);
});

test('executeSOPAgentSession is used when sessionType is set', async () => {
    const subsystem = new OrchestratorSkillsSubsystem({
        llmAgent: {
            startSOPLangAgentSession: async () => ({
                getVariables: () => ({ lastAnswer: 'SOP result' }),
                getLastResult: () => 'SOP result',
            }),
        },
    });

    const skillRecord = {
        name: 'test-orchestrator',
        metadata: {
            sessionType: 'sop',
            instructions: 'SOP instructions',
            allowedSkills: ['skill1'],
        },
    };

    const recursiveAgent = {
        skillCatalog: new Map([['skill1', { name: 'skill1' }]]),
    };

    const result = await subsystem.executeSkillPrompt({
        skillRecord,
        recursiveAgent,
        promptText: 'Test SOP prompt',
    });

    assert.equal(result.result.session, 'sop');
    assert.equal(result.result.output, 'SOP result');
});
