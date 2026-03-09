import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { RecursiveSkilledAgent } from '../../RecursiveSkilledAgents/RecursiveSkilledAgent.mjs';
import { LLMAgent } from '../../LLMAgents/LLMAgent.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Stub LLM agent that doesn't make real API calls.
 */
class StubLLMAgent extends LLMAgent {
    constructor() {
        super({ name: 'StubLLMAgent' });
    }

    executePrompt(prompt, options = {}) {
        // Return empty response - we just want to test the skill invocation path
        return { result: 'stub response' };
    }

    async startSOPLangAgentSession(skillsDescription, promptText) {
        return {
            getVariables: async () => ({}),
            getLastResult: () => ({
                message: `Code generation completed for ${promptText}`,
                generatedFiles: [],
            }),
        };
    }
}

test('internal skills', async (t) => {
    await t.test('mirror-code-generator is registered by default', async () => {
        const agent = new RecursiveSkilledAgent({
            llmAgent: new StubLLMAgent(),
            startDir: __dirname,
            searchUpwards: false,
        });

        // Wait for pending preparations (internal skill registration is async)
        await Promise.all(agent.executor.pendingPreparations);

        const skillRecord = agent.getSkillRecord('mirror-code-generator');

        assert.ok(skillRecord, 'mirror-code-generator should be registered');
        assert.equal(skillRecord.type, 'orchestrator', 'should be registered as orchestrator type');
        assert.ok(skillRecord.metadata?.modulePath, 'should have modulePath in metadata');
        assert.ok(skillRecord.metadata.modulePath.includes('mirror-code-generator/src/index.mjs'), 'modulePath should point to mirror-code-generator/src/index.mjs');
    });

    await t.test('mirror-code-generator can be invoked through executeWithReviewMode', async () => {
        const agent = new RecursiveSkilledAgent({
            llmAgent: new StubLLMAgent(),
            startDir: __dirname,
            searchUpwards: false,
        });

        // Wait for pending preparations
        await Promise.all(agent.executor.pendingPreparations);

        // Use a non-existent path - we expect it to return empty array (no specs dir)
        // but the important thing is that the call goes through without errors
        const nonExistentPath = path.join(__dirname, 'non-existent-skill-dir');

        const result = await agent.executeWithReviewMode(nonExistentPath, {
            skillName: 'mirror-code-generator',
        }, 'none');

        assert.ok(result, 'should return a result');
        assert.equal(result.skill, 'mirror-code-generator', 'should report correct skill name');
        assert.equal(result.subsystem, 'orchestrator', 'should be executed through orchestrator subsystem');
        
        // The result.result should contain our action's return value
        assert.ok(result.result, 'should have result property');
        assert.ok(result.result, 'should have output from module execution');
        assert.ok(result.result.message, 'output should have message');
        assert.ok(Array.isArray(result.result.generatedFiles), 'output should have generatedFiles array');
        
        // Since there's no specs dir, generatedFiles should be empty
        assert.equal(result.result.generatedFiles.length, 0, 'generatedFiles should be empty for non-existent path');
    });
});
