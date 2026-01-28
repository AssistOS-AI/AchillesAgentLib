import assert from 'node:assert';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RecursiveSkilledAgent } from '../../RecursiveSkilledAgents/RecursiveSkilledAgent.mjs';
import { LLMAgent } from '../../LLMAgents/LLMAgent.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

class MockLLMAgent extends LLMAgent {
  async executePrompt(prompt) {
    if (prompt.includes("Multi-File Code Generation Request")) {
      const code = 'import { fileURLToPath } from "node:url";\n' +
                   'import { dirname } from "node:path";\n\n' +
                   'export async function action(args) {\n' +
                   '  if (!args || !args.llmAgent) {\n' +
                   '    throw new Error("Missing llmAgent");\n' +
                   '  }\n' +
                   '  if (!args.promptText) {\n' +
                   '    throw new Error("Missing promptText");\n' +
                   '  }\n' +
                   '  return "OK";\n' +
                   '}\n\n' +
                   '// Child process entry point\n' +
                   'if (process.argv[1] === fileURLToPath(import.meta.url)) {\n' +
                   '  const argsJson = process.argv[2];\n' +
                   '  const args = JSON.parse(argsJson);\n' +
                   '  action(args)\n' +
                   '    .then(res => process.stdout.write(JSON.stringify(res)))\n' +
                   '    .catch(err => {\n' +
                   '      console.error("Error in generated code:", err);\n' +
                   '      process.exit(1);\n' +
                   '    });\n' +
                   '}\n';
      return '## file-path: index.mjs\n\n' + '```javascript\n' + code + '```';
    }
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

  const result = await agent.executePrompt('generate: Hello', {
    skillName: 'generate-text',
  });

  assert.strictEqual(result.result, 'OK');
  console.log('✅ llmAgent injected for cskill');
}

runTest().catch((error) => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});
