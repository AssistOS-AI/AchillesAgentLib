import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { LLMAgent } from '../../LLMAgents/LLMAgent.mjs';
import { generateBehaviorTests } from '../../RecursiveSkilledAgents/mirror-code-generator/index.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, 'fixtures', 'behaviorTestGeneration');

async function listFixtureDirs() {
  const entries = await fs.readdir(fixturesDir, { withFileTypes: true });
  return entries
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort();
}

async function loadFixture(fixtureName) {
  const baseDir = path.join(fixturesDir, fixtureName);
  const specsPath = path.join(baseDir, 'specs.md');
  const codePath = path.join(baseDir, 'code', 'index.mjs');

  const [specs, code] = await Promise.all([
    fs.readFile(specsPath, 'utf-8'),
    fs.readFile(codePath, 'utf-8'),
  ]);

  return { baseDir, specs, code, codePath };
}

async function runFixture(fixtureName, llmAgent) {
  const { specs, code, codePath } = await loadFixture(fixtureName);
  const tests = await generateBehaviorTests(specs, code, llmAgent);

  const moduleUrl = pathToFileURL(codePath).href;
  const module = await import(moduleUrl);
  if (typeof module.action !== 'function') {
    throw new Error(`Fixture ${fixtureName} does not export action()`);
  }

  for (const test of tests) {
    if (!test || typeof test.promptText !== 'string') {
      throw new Error(`Fixture ${fixtureName} returned invalid test promptText`);
    }
    if (!Object.prototype.hasOwnProperty.call(test, 'expectedOutput')) {
      throw new Error(`Fixture ${fixtureName} test missing expectedOutput`);
    }

    const result = await module.action({ promptText: test.promptText });
    try {
      assert.deepStrictEqual(result, test.expectedOutput);
    } catch (error) {
      const debugPayload = {
        fixture: fixtureName,
        testName: test.name || null,
        promptText: test.promptText,
        expectedOutput: test.expectedOutput,
        actualOutput: result,
      };
      console.log('Generated test case failed:', JSON.stringify(debugPayload, null, 2));
      throw error;
    }
  }
}

async function evalBehaviorTestGeneration() {
  const llmAgent = new LLMAgent({ name: 'evalBehaviorTests' });

  const fixtures = await listFixtureDirs();
  if (fixtures.length === 0) {
    throw new Error('No behaviorTestGeneration fixtures found.');
  }

  let passed = 0;
  let failed = 0;

  for (const fixture of fixtures) {
    try {
      console.log(`\n=== Behavior Test Generation: ${fixture} ===`);
      await runFixture(fixture, llmAgent);
      console.log(`🟢 ${fixture}: All tests passed`);
      passed += 1;
    } catch (error) {
      console.log(`🔴 ${fixture}: ${error.message}`);
      failed += 1;
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('📊 BEHAVIOR TEST GENERATION SUMMARY');
  console.log('='.repeat(60));
  console.log(`🟢 Passed: ${passed}/${fixtures.length}`);
  console.log(`🔴 Failed: ${failed}/${fixtures.length}`);
  console.log(`📈 Success Rate: ${Math.round((passed / fixtures.length) * 100)}%`);
}

await evalBehaviorTestGeneration();
