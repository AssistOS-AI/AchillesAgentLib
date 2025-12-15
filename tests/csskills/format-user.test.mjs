import assert from 'node:assert';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RecursiveSkilledAgent } from '../../RecursiveSkilledAgents/RecursiveSkilledAgent.mjs';
import { LLMAgent } from '../../LLMAgents/LLMAgent.mjs';

// Get the directory of the current module
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// --- Mock LLM Agent ---
class MockLLMAgent extends LLMAgent {
  constructor() {
    super();
  }

  async executePrompt(prompt, options = {}) {
    if (prompt.includes("extract structured arguments")) {
      console.log("MOCK LLM: Responding with extracted arguments...");
      return {
        args: {
          user: {
            firstName: 'Jane',
            lastName: 'Doe',
            age: 25,
          },
        },
      };
    }

    if (prompt.includes("create self-contained Javascript ESM code")) {
      console.log("MOCK LLM: Responding with generated code...");
      // Using string concatenation to avoid nested template literal issues.
      const code = 'export async function action(args) {\n' +
        '  const { user } = args;\n' +
        '  if (!user || !user.firstName || !user.lastName || user.age === undefined) {\n' +
        '    return "Error: Incomplete user data provided.";\n' +
        '  }\n' +
        '  const fullName = `${user.firstName} ${user.lastName}`\n' +
        '  const status = user.age >= 18 ? \'Adult\' : \'Minor\';\n' +
        '  return `Full Name: ${fullName}, Age: ${user.age} (${status})`\n' +
        '}\n';
      
      const markdownResponse = '## file-path: index.mjs\n\n' +
        '```javascript\n' +
        code +
        '```';
        
      return markdownResponse;
    }

    throw new Error("MockLLMAgent received an unexpected prompt.");
  }
}

// --- Test Runner ---
async function runTest() {
  console.log("Setting up test for csskill: format-user...");

  const mockAgent = new MockLLMAgent();
  
  const agent = new RecursiveSkilledAgent({
    llmAgent: mockAgent,
    // Use additionalSkillRoots for explicit skill loading in tests
    additionalSkillRoots: [path.resolve(__dirname, '.AchillesSkills')],
    searchUpwards: false,
  });

  await Promise.all(agent.pendingPreparations || []);
  
  const skill = agent.getSkillRecord('format-user');
  assert(skill, "Test setup failed: 'format-user' skill not found.");
  assert.strictEqual(skill.type, 'csskill', "Test setup failed: Skill type should be 'csskill'.");
  
  console.log("Executing skill 'format-user'...");
  const prompt = "Please format the user Jane Doe, who is 25 years old.";
  
  try {
    const result = await agent.executePrompt(prompt, { skillName: 'format-user' });
    
    console.log("Skill executed. Result object:", result);
    
    // Workaround for the strange string-like object returned by the executor.
    // Reconstruct the string from its character properties.
    const reconstructedResult = Object.keys(result)
      .filter(key => !isNaN(parseInt(key))) // Filter for numeric keys
      .sort((a, b) => parseInt(a) - parseInt(b)) // Sort them numerically
      .map(key => result[key]) // Get the character values
      .join(''); // Join them into a string

    console.log("Reconstructed result:", reconstructedResult);

    const expected = "Full Name: Jane Doe, Age: 25 (Adult)";
    assert.strictEqual(reconstructedResult, expected, `Test failed: Expected '${expected}', but got '${reconstructedResult}'`);
    
    console.log("✅ Test Passed!");
    
    console.log("✅ Test Passed!");
  } catch (error) {
    console.error("❌ Test Failed:", error);
    process.exit(1);
  }
}

runTest();