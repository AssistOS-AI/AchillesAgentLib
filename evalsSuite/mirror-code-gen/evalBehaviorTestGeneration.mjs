import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LLMAgent } from '../../LLMAgents/LLMAgent.mjs';
import { generateBehaviorTests } from '../../RecursiveSkilledAgents/mirror-code-generator/index.mjs';
import { runBehaviorTestsOnDisk } from '../../RecursiveSkilledAgents/mirror-code-generator/testing.mjs';

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
  const { baseDir, specs, code, codePath } = await loadFixture(fixtureName);
  const importPath = '../code/index.mjs';
  const { tests, runnerCode } = await generateBehaviorTests(specs, code, llmAgent, { importPath });

  const testResults = await runBehaviorTestsOnDisk(
    baseDir,
    'code/index.mjs',
    tests,
    runnerCode,
    { logger: console }
  );

  if (testResults?.skipped) {
    throw new Error(`Fixture ${fixtureName} runner/cases validation failed; tests skipped.`);
  }

  const failures = testResults.results.filter(result => !result.pass);
  if (failures.length > 0) {
    for (const failure of failures) {
      const debugPayload = {
        fixture: fixtureName,
        testName: failure.name || null,
        input: failure.input ?? null,
        expectedOutput: failure.expectedOutput,
        actualOutput: failure.actual,
      };
      console.log('Generated test case failed:', JSON.stringify(debugPayload, null, 2));
    }
    throw new Error(`Fixture ${fixtureName} returned failing tests.`);
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
