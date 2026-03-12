import assert from 'node:assert/strict';
import { test } from 'node:test';

import { OrchestratorSkillsSubsystem } from '../../OrchestratorSkillsSubsystem/OrchestratorSkillsSubsystem.mjs';
import { StubLLMAgent } from '../helpers/stubLLMAgent.mjs';

test('resolveAllowedSkills allows all skill types except self when no allowlist', () => {
    const subsystem = new OrchestratorSkillsSubsystem({ llmAgent: new StubLLMAgent() });

    const skillRecord = {
        name: 'orchestrator-skill',
        preparedConfig: { allowedSkills: [] },
    };

    const allSkills = [
        { name: 'cskill-1', type: 'cskill' },
        { name: 'mcp-1', type: 'mcp' },
        { name: 'dbtable-1', type: 'dbtable' },
        { name: 'claude-1', type: 'claude' },
        { name: 'code-gen-1', type: 'dynamic-code-generation' },
        { name: 'orchestrator-skill', type: 'orchestrator' },
    ];

    const recursiveAgent = {
        skillCatalog: new Map(allSkills.map(skill => [skill.name, skill])),
    };

    const filtered = subsystem.resolveAllowedSkills(skillRecord, recursiveAgent);

    const allowedTypes = filtered.map(skill => skill.type);
    const expectedTypes = ['cskill', 'mcp', 'dbtable', 'claude', 'dynamic-code-generation'];

    assert.equal(filtered.length, 5, 'should allow all skill types except self');
    assert.deepEqual(allowedTypes.sort(), expectedTypes.sort(), 'should allow all types except orchestrator self');
});

test('resolveAllowedSkills excludes self from allowed skills', () => {
    const subsystem = new OrchestratorSkillsSubsystem({ llmAgent: new StubLLMAgent() });

    const skillRecord = {
        name: 'self-orchestrator',
        preparedConfig: { allowedSkills: [] },
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
        preparedConfig: { allowedSkills: ['allowed-skill'] },
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
            name: 'Test Orchestrator',
            rawContent: 'Test body',
            sections: {
                instructions: 'Test instructions',
                'allowed-skills': '- skill1\n- skill2',
                intents: 'reporting: Generate reports\ndata: Fetch data',
                session: 'sop',
            },
        },
    };

    subsystem.prepareSkill(skillRecord);

    assert.equal(skillRecord.preparedConfig.name, 'Test Orchestrator');
    assert.equal(skillRecord.preparedConfig.rawContent, 'Test body');
    assert.equal(skillRecord.preparedConfig.instructions, 'Test instructions');
    assert.deepEqual(skillRecord.preparedConfig.allowedSkills, ['skill1', 'skill2']);
    assert.equal(skillRecord.preparedConfig.intents, 'reporting: Generate reports\ndata: Fetch data');
    assert.equal(skillRecord.preparedConfig.sessionType, null);
    });

test('buildToolDescriptions generates descriptions from skill descriptor', () => {
    const subsystem = new OrchestratorSkillsSubsystem({ llmAgent: new StubLLMAgent() });

    const allowedSkills = [
        {
            descriptor: {
                rawContent: 'Primary description',
                name: 'Skill Title',
            },
            shortName: 'short',
            name: 'full-skill-name',
        },
        {
            descriptor: {
                rawContent: 'Only summary',
            },
            shortName: 'short2',
            name: 'skill2',
        },
    ];

    const descriptions = subsystem.buildToolDescriptions(allowedSkills);

    assert.equal(descriptions.short, 'Primary description');
    assert.equal(descriptions.short2, 'Only summary');
});

test('executeLoopAgentSession is used when sessionType is set', async () => {
    const subsystem = new OrchestratorSkillsSubsystem({
        llmAgent: {
            startLoopAgentSession: async () => ({
                getLastResult: () => 'Loop result',
            }),
        },
    });

    const skillRecord = {
        name: 'test-orchestrator',
        preparedConfig: {
            sessionType: 'loop',
            instructions: 'Loop instructions',
            allowedSkills: ['skill1'],
        },
    };

    const recursiveAgent = {
        skillCatalog: new Map([['skill1', { name: 'skill1' }]]),
    };

    const result = await subsystem.executeSkillPrompt({
        skillRecord,
        recursiveAgent,
        promptText: 'Test loop prompt',
    });

    assert.equal(result.session, 'loop');
    assert.equal(result.result, 'Loop result');
});
