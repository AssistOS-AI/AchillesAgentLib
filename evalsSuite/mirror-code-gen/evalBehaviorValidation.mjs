import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LLMAgent } from '../../LLMAgents/LLMAgent.mjs';
import { envAutoConfig } from '../../LLMAgents/envAutoConfig.mjs';
import { validateOrRepairGeneratedCode } from '../../RecursiveSkilledAgents/mirror-code-generator.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, 'fixtures', 'behaviorValidation');

async function listFixtureDirs() {
  const entries = await fs.readdir(fixturesDir, { withFileTypes: true });
  return entries
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort();
}

async function loadFixture(fixtureName) {
  const baseDir = path.join(fixturesDir, fixtureName);
  const testsPath = path.join(baseDir, 'tests.json');
  const expectedPath = path.join(baseDir, 'expected.json');
  const codeDir = path.join(baseDir, 'code');

  const [testsRaw, expectedRaw] = await Promise.all([
    fs.readFile(testsPath, 'utf-8'),
    fs.readFile(expectedPath, 'utf-8'),
  ]);

  const tests = JSON.parse(testsRaw);
  const expected = JSON.parse(expectedRaw);

  const codeEntries = await fs.readdir(codeDir, { withFileTypes: true });
  const files = new Map();
  for (const entry of codeEntries) {
    if (!entry.isFile()) continue;
    const filePath = path.join(codeDir, entry.name);
    const code = await fs.readFile(filePath, 'utf-8');
    files.set(entry.name, code);
  }

  return { tests, expected, files };
}

async function runFixture(fixtureName, llmAgent) {
  const { tests, expected, files } = await loadFixture(fixtureName);

  if (!Array.isArray(tests)) {
    throw new Error(`Fixture ${fixtureName} tests.json must be an array.`);
  }
  if (!expected || (expected.status !== 'pass' && expected.status !== 'fail')) {
    throw new Error(`Fixture ${fixtureName} expected.json must include status pass/fail.`);
  }

  const result = await validateOrRepairGeneratedCode(files, tests, llmAgent);
  if (result.status !== expected.status) {
    throw new Error(`Expected status ${expected.status}, got ${result.status}`);
  }
  if (result.status === 'fail' && (!Array.isArray(result.files) || result.files.length === 0)) {
    throw new Error('Expected fail response to include files.');
  }
}

async function evalBehaviorValidation() {
  await envAutoConfig();
  const llmAgent = new LLMAgent({ name: 'evalBehaviorValidation' });

  const fixtures = await listFixtureDirs();
  if (fixtures.length === 0) {
    throw new Error('No behaviorValidation fixtures found.');
  }

  let passed = 0;
  let failed = 0;

  for (const fixture of fixtures) {
    try {
      console.log(`\n=== Behavior Validation: ${fixture} ===`);
      await runFixture(fixture, llmAgent);
      console.log(`🟢 ${fixture}: All checks passed`);
      passed += 1;
    } catch (error) {
      console.log(`🔴 ${fixture}: ${error.message}`);
      failed += 1;
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('📊 BEHAVIOR VALIDATION SUMMARY');
  console.log('='.repeat(60));
  console.log(`🟢 Passed: ${passed}/${fixtures.length}`);
  console.log(`🔴 Failed: ${failed}/${fixtures.length}`);
  console.log(`📈 Success Rate: ${Math.round((passed / fixtures.length) * 100)}%`);
}

await evalBehaviorValidation();
