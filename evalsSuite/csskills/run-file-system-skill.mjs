import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RecursiveSkilledAgent } from '../../RecursiveSkilledAgents/RecursiveSkilledAgent.mjs';
import { LLMAgent } from '../../LLMAgents/LLMAgent.mjs';
import { envAutoConfig } from '../../LLMAgents/envAutoConfig.mjs';
import { rm, mkdir } from 'node:fs/promises';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function runFileSystemSkillTest() {
  // Configure LLM environment for code generation
  await envAutoConfig();

  // Create a temporary directory for the test to operate in
  const testWorkspace = path.resolve(__dirname, 'fs-test-workspace');
  await rm(testWorkspace, { recursive: true, force: true });
  await mkdir(testWorkspace, { recursive: true });
  console.log(`✅ Test workspace created at: ${testWorkspace}`);

  // Initialize the agent with a real LLM for code generation
  const llmAgent = new LLMAgent({ name: 'FileSystem-Skill-Test' });
  const agent = new RecursiveSkilledAgent({
    llmAgent,
    additionalSkillRoots: [path.resolve(__dirname, '.AchillesSkills')],
    searchUpwards: false,
  });

  console.log("⏳ Preparing skills (will trigger code generation for file-system-manager)...");
  await Promise.all(agent.pendingPreparations || []);
  console.log("✅ Skills prepared.");

  // --- Test Case: Create and then read a file ---
  try {
    console.log("\n--- Testing File Creation and Reading ---");
    const testFilePath = path.join(testWorkspace, 'hello.txt');
    const testContent = 'Hello, world!';

    // 1. Create the file
    console.log(`\nExecuting 'createFile' for: ${testFilePath}`);
    await agent.executePrompt("create a file", {
      skillName: 'file-system-manager',
      args: {
        method: 'createFile',
        params: [testFilePath, testContent]
      }
    });
    console.log(`✅ 'createFile' executed.`);

    // 2. Read the file back
    console.log(`\nExecuting 'readFile' for: ${testFilePath}`);
    const result = await agent.executePrompt("read a file", {
        skillName: 'file-system-manager',
        args: {
            method: 'readFile',
            params: [testFilePath]
        }
    });

    if (result.trim() === testContent) {
        console.log(`✅ 'readFile' returned correct content: `);
    } else {
        throw new Error(`Content mismatch! Expected "", got ""`);
    }

    console.log("\n✅ File System Skill test passed successfully!");
  } catch (error) {
    console.error("❌ A test failed:", error);
    process.exit(1);
  } finally {
    // Clean up
    await rm(testWorkspace, { recursive: true, force: true });
    console.log("\n✅ Cleaned up test workspace.");
  }
}

runFileSystemSkillTest();
