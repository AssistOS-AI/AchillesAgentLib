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
    if (prompt.includes("Test Plan Generation")) {
      const sourceMatch = prompt.match(/Source Files\s*\n([^\n:]+):/);
      const sourceFile = sourceMatch ? sourceMatch[1].trim() : 'src/index.js';
      return {
        testPlans: [
          {
            description: 'Basic action behavior test plan.',
            sourceFiles: [sourceFile],
          },
        ],
      };
    }

    if (prompt.includes("Test File Generation")) {
      return {
        fileName: 'basic.test.mjs',
        content: 'process.stdout.write(JSON.stringify({ results: [{ name: "basic", pass: true }] }));\n',
        testCases: [],
      };
    }

    if (prompt.includes("Single-File Code Generation Request")) {
      console.log("MOCK LLM: Responding to single-file code generation...");
      const targetMatch = prompt.match(/# Spec for:\s*([^\n]+)/);
      const targetPath = targetMatch ? targetMatch[1].trim() : 'src/index.js';

      if (targetPath.endsWith('new-module.js')) {
        const newModuleCode = 'export function newModuleFunction() {\n' +
          '  return "New module is working!";\n' +
          '}\n';
        return `## file-path: ${targetPath}\n\n` + '```javascript\n' + newModuleCode + '```';
      }

      if (targetPath.endsWith('index.mjs')) {
        const generateTextCode = 'export async function action(args) {\n' +
          '  if (!args || !args.llmAgent) {\n' +
          '    throw new Error("Missing llmAgent");\n' +
          '  }\n' +
          '  if (!args.promptText) {\n' +
          '    throw new Error("Missing promptText");\n' +
          '  }\n' +
          '  return "OK";\n' +
          '}\n';
        return `## file-path: ${targetPath}\n\n` + '```javascript\n' + generateTextCode + '```';
      }

      const code = 'import { fileURLToPath } from "node:url";\n' +
        'import { dirname } from "node:path";\n\n' +
        'export async function action(args) {\n' +
        '  const input = args?.promptText || "";\n' +
        '  const match = input.match(/([A-Z][a-z]+)\\s+([A-Z][a-z]+).*?(\\d+)/);\n' +
        '  if (!match) { return "Error: Incomplete user data provided."; }\n' +
        '  const fullName = `${match[1]} ${match[2]}`;\n' +
        '  const age = Number(match[3]);\n' +
        '  const status = age >= 18 ? \'Adult\' : \'Minor\';\n' +
        '  const result = `Full Name: ${fullName}, Age: ${age} (${status})`;\n' +
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
      return `## file-path: ${targetPath}\n\n` + '```javascript\n' + code + '```';
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

  const skillDir = path.resolve(__dirname, 'skills/format-user');
  const indexFile1 = path.resolve(skillDir, 'src/index.js');
  const newSpecFile = path.resolve(__dirname, 'skills/format-user/specs/new-module.js.md');
  const newModuleFile = path.resolve(skillDir, 'src/new-module.js');

  // Clean up leftovers from previous runs
  await rm(newSpecFile, { force: true });
  await rm(indexFile1, { force: true });
  await rm(newModuleFile, { force: true });
  await rm(path.resolve(skillDir, 'tests'), { recursive: true, force: true });

  // Initialize the agent
  const mockLlm = new MockLLMAgent();
  const agent = new RecursiveSkilledAgent({
    llmAgent: mockLlm,
    additionalSkillRoots: [path.resolve(__dirname, 'skills')],
    searchUpwards: false,
  });

  // Wait for initial skill preparation
  await Promise.all(agent.pendingPreparations || []);
  console.log("✅ Initial skill preparation completed\n");

  // Test 1: Verify initial code generation
  console.log("Test 1: Verifying initial code generation...");
  const skillStat1 = await stat(skillDir);
  assert.strictEqual(skillStat1.isDirectory(), true, "skill folder should exist");
  
  const indexStat1 = await stat(indexFile1);
  assert.strictEqual(indexStat1.isFile(), true, "index.mjs should exist");
  
  const initialCode = await readFile(indexFile1, 'utf-8');
  assert.ok(initialCode.includes('Full Name:'), "Generated code should contain expected logic");
  assert.ok(!initialCode.includes('newModuleFunction'), "Initial code should not contain new module");
  console.log("✅ Initial code generation verified\n");

  // Test 2: Verify no regeneration when specs unchanged
  console.log("Test 2: Testing no regeneration when specs unchanged...");
  
  // Force re-preparation by creating new agent instance
  const agent2 = new RecursiveSkilledAgent({
    llmAgent: mockLlm,
    additionalSkillRoots: [path.resolve(__dirname, 'skills')],
    searchUpwards: false,
  });
  
  await Promise.all(agent2.pendingPreparations || []);
  console.log("✅ No regeneration occurred (fast completion)\n");

  // Test 3: Add new specification file and verify regeneration
  console.log("Test 3: Adding new specification file and testing regeneration...");
  
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
    additionalSkillRoots: [path.resolve(__dirname, 'skills')],
    searchUpwards: false,
  });
  
  await Promise.all(agent3.pendingPreparations || []);
  console.log("✅ Regeneration completed with new specifications\n");

  // Verify new code includes the new module
  const newModuleStat = await stat(newModuleFile);
  assert.strictEqual(newModuleStat.isFile(), true, "new-module.js should exist");
  const regeneratedModuleCode = await readFile(newModuleFile, 'utf-8');
  assert.ok(regeneratedModuleCode.includes('newModuleFunction'), "Regenerated code should contain new function");
  console.log("✅ Regenerated code includes new module\n");

  // Test 4: Execute the skill with regenerated code
  console.log("Test 4: Executing skill with regenerated code...");
  const result = await agent3.executePrompt(
    'Format user data for Jane Doe, age 25',
    { skillName: 'format-user' }
  );
  
  // The result from executePrompt wraps primitive values in { result: value }
  const reconstructedResult = result.result;

  const expected = "Full Name: Jane Doe, Age: 25 (Adult)";
  assert.strictEqual(reconstructedResult, expected, `Execution result should match expected output`);
  console.log("✅ Skill execution successful with regenerated code\n");

  // Test 5: Clean up - remove new spec file and generated code
  console.log("Test 5: Cleaning up test files...");
  await rm(newSpecFile, { force: true });
  await rm(indexFile1, { force: true });
  await rm(newModuleFile, { force: true });
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
