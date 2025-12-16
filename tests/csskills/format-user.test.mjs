import assert from 'node:assert';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RecursiveSkilledAgent } from '../../RecursiveSkilledAgents/RecursiveSkilledAgent.mjs';
import { LLMAgent } from '../../LLMAgents/LLMAgent.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

class MockLLMAgent extends LLMAgent {
  constructor() {
    super();
  }

  async executePrompt(prompt, options = {}) {
    if (prompt.includes("BEGIN SPECIFICATIONS BLUEPRINT")) {
      console.log("MOCK LLM: Responding to 'prepareSkill' with generated code (writes to disk)...");
      const code = 'import { fileURLToPath } from "node:url";\n' +
                   'import { dirname } from "node:path";\n\n' +
                   'export async function action(args) {\n' +
                   '  const { user } = args;\n' +
                   '  if (!user || !user.firstName || !user.lastName || user.age === undefined) { return "Error: Incomplete user data provided."; }\n' +
                   '  const fullName = `${user.firstName} ${user.lastName}`;\n' +
                   '  const status = user.age >= 18 ? \'Adult\' : \'Minor\';\n' +
                   '  const result = `Full Name: ${fullName}, Age: ${user.age} (${status})`;\n' +
                   '  return result;\n' +
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

    if (prompt.includes("extract structured arguments")) {
      console.log("MOCK LLM: Responding to 'executePrompt' with extracted arguments...");
      return {
        args: {
          user: { firstName: 'Jane', lastName: 'Doe', age: 25 },
        },
      };
    }

    throw new Error("MockLLMAgent received an unexpected prompt: " + prompt);
  }
}

async function testLlmExtraction(agent) {
  console.log("\n--- Testing LLM Extraction Path ---");
  const prompt = "Please format the user Jane Doe, who is 25 years old.";

  console.log(`Executing with natural language prompt: "${prompt}"`);
  const result = await agent.executePrompt(prompt, { skillName: 'format-user' });

  // The result from executePrompt is wrapped by the agent. Reconstruct the string.
  const reconstructedResult = Object.keys(result)
    .filter(key => !isNaN(parseInt(key)))
    .sort((a, b) => parseInt(a) - parseInt(b))
    .map(key => result[key])
    .join('');

  const expected = "Full Name: Jane Doe, Age: 25 (Adult)";
  assert.strictEqual(reconstructedResult, expected, `LLM Extraction Test failed`);
  console.log("✅ LLM Extraction Test Passed!");
}

import { rm } from 'node:fs/promises';

async function runAllTests() {
  console.log("Setting up LLM extraction test...");
  const mockLlm = new MockLLMAgent();
  
  console.log("Initializing agent (triggers code generation and writing to disk)...");
  const agent = new RecursiveSkilledAgent({
    llmAgent: mockLlm,
    additionalSkillRoots: [path.resolve(__dirname, '.AchillesSkills')],
    searchUpwards: false,
  });

  await Promise.all(agent.pendingPreparations || []);
  console.log("Agent initialized and skill prepared.");

  try {
    await testLlmExtraction(agent);
    console.log("\nAll tests passed successfully!");
    
    // Clean up: remove generated src folder to keep repository clean
    const srcFolder = path.resolve(__dirname, '.AchillesSkills/format-user/src');
    try {
      await rm(srcFolder, { recursive: true, force: true });
      console.log("✅ Cleaned up generated src folder");
    } catch (cleanupError) {
      console.warn("⚠️  Could not clean up src folder:", cleanupError.message);
    }
    
  } catch (error) {
    console.error("❌ A test failed:", error);
    process.exit(1);
  }
}

runAllTests();