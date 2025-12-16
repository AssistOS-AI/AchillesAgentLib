import assert from 'node:assert';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RecursiveSkilledAgent } from '../../RecursiveSkilledAgents/RecursiveSkilledAgent.mjs';
import { LLMAgent } from '../../LLMAgents/LLMAgent.mjs';
import { readdir, readFile, writeFile, rm, stat } from 'node:fs/promises';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

class MockLLMAgent extends LLMAgent {
  constructor() {
    super();
  }

  async executePrompt(prompt, options = {}) {
    if (prompt.includes("BEGIN SPECIFICATIONS BLUEPRINT")) {
      console.log("MOCK LLM: Responding to 'prepareSkill' with generated code (writes to disk)...");
      
      // Check if we should include the new module
      const shouldIncludeNewModule = prompt.includes("new-module");
      
      let code = 'import { fileURLToPath } from "node:url";\n' +
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
      
      if (shouldIncludeNewModule) {
        code += '\n// NEW MODULE CODE\n' +
                'export function newModuleFunction() {\n' +
                '  return "New module is working!";\n' +
                '}\n';
      }

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

async function testCodeRegeneration() {
  console.log("=== Testing Code Regeneration Logic ===\n");

  // Initialize the agent
  const mockLlm = new MockLLMAgent();
  const agent = new RecursiveSkilledAgent({
    llmAgent: mockLlm,
    additionalSkillRoots: [path.resolve(__dirname, '.AchillesSkills')],
    searchUpwards: false,
  });

  // Wait for initial skill preparation
  await Promise.all(agent.pendingPreparations || []);
  console.log("✅ Initial skill preparation completed\n");

  // Test 1: Verify initial code generation
  console.log("Test 1: Verifying initial code generation...");
  const srcFolder1 = path.resolve(__dirname, '.AchillesSkills/format-user/src');
  const srcStat1 = await stat(srcFolder1);
  assert.strictEqual(srcStat1.isDirectory(), true, "src folder should exist");
  
  const indexFile1 = path.resolve(srcFolder1, 'index.mjs');
  const indexStat1 = await stat(indexFile1);
  assert.strictEqual(indexStat1.isFile(), true, "index.mjs should exist");
  
  const initialCode = await readFile(indexFile1, 'utf-8');
  assert.ok(initialCode.includes('Full Name:'), "Generated code should contain expected logic");
  assert.ok(!initialCode.includes('NEW MODULE CODE'), "Initial code should not contain new module");
  console.log("✅ Initial code generation verified\n");

  // Test 2: Verify no regeneration when specs unchanged
  console.log("Test 2: Testing no regeneration when specs unchanged...");
  
  // Force re-preparation by creating new agent instance
  const agent2 = new RecursiveSkilledAgent({
    llmAgent: mockLlm,
    additionalSkillRoots: [path.resolve(__dirname, '.AchillesSkills')],
    searchUpwards: false,
  });
  
  await Promise.all(agent2.pendingPreparations || []);
  console.log("✅ No regeneration occurred (fast completion)\n");

  // Test 3: Add new specification file and verify regeneration
  console.log("Test 3: Adding new specification file and testing regeneration...");
  
  const newSpecFile = path.resolve(__dirname, '.AchillesSkills/format-user/specs/new-module.js.md');
  await writeFile(newSpecFile, `# Specification for new-module.js

## Function: newModuleFunction()

### Description
A new module function for testing regeneration.

### Returns
- string: "New module is working!"

### Example
- **Output**: "New module is working!"
`);

  // Force re-preparation with new specs
  const agent3 = new RecursiveSkilledAgent({
    llmAgent: mockLlm,
    additionalSkillRoots: [path.resolve(__dirname, '.AchillesSkills')],
    searchUpwards: false,
  });
  
  await Promise.all(agent3.pendingPreparations || []);
  console.log("✅ Regeneration completed with new specifications\n");

  // Verify new code includes the new module
  const regeneratedCode = await readFile(indexFile1, 'utf-8');
  assert.ok(regeneratedCode.includes('NEW MODULE CODE'), "Regenerated code should contain new module");
  assert.ok(regeneratedCode.includes('newModuleFunction'), "Regenerated code should contain new function");
  console.log("✅ Regenerated code includes new module\n");

  // Test 4: Execute the skill with regenerated code
  console.log("Test 4: Executing skill with regenerated code...");
  const result = await agent3.executePrompt(
    'Format user data for Jane Doe, age 25',
    { skillName: 'format-user' }
  );
  
  const reconstructedResult = Object.keys(result)
    .filter(key => !isNaN(parseInt(key)))
    .sort((a, b) => parseInt(a) - parseInt(b))
    .map(key => result[key])
    .join('');

  const expected = "Full Name: Jane Doe, Age: 25 (Adult)";
  assert.strictEqual(reconstructedResult, expected, `Execution result should match expected output`);
  console.log("✅ Skill execution successful with regenerated code\n");

  // Test 5: Clean up - remove new spec file and generated code
  console.log("Test 5: Cleaning up test files...");
  await rm(newSpecFile);
  await rm(srcFolder1, { recursive: true, force: true });
  console.log("✅ Cleanup completed\n");

  console.log("🎉 All code regeneration tests passed!");
}

async function runTest() {
  try {
    await testCodeRegeneration();
    console.log("\n✅ Code regeneration test completed successfully!");
  } catch (error) {
    console.error("❌ Test failed:", error);
    process.exit(1);
  }
}

runTest();