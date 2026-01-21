import assert from 'node:assert';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RecursiveSkilledAgent } from '../../RecursiveSkilledAgents/RecursiveSkilledAgent.mjs';
import { LLMAgent } from '../../LLMAgents/LLMAgent.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

class MockLLMAgent extends LLMAgent {
  async executePrompt() {
    return { args: {} };
  }
}

async function runTest() {
  const agent = new RecursiveSkilledAgent({
    llmAgent: new MockLLMAgent(),
    additionalSkillRoots: [path.resolve(__dirname, '.AchillesSkills')],
    searchUpwards: false,
  });

  await Promise.all(agent.pendingPreparations || []);

  const result = await agent.executePrompt('seed generate text', {
    skillName: 'generate-text',
    args: {
      generationPrompt: 'Hello',
      context: '',
      mode: 'fast',
    },
  });

  assert.strictEqual(result.result, 'OK');
  console.log('✅ llmAgent injected for cskill');
}

runTest().catch((error) => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});
