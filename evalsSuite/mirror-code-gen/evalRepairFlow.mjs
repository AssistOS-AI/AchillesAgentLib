import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LLMAgent } from '../../LLMAgents/LLMAgent.mjs';
import { envAutoConfig } from '../../LLMAgents/envAutoConfig.mjs';
import { repairGeneratedFile, runBehaviorTestsInTemp } from '../../RecursiveSkilledAgents/mirror-code-generator/testing.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, 'fixtures', 'repairFlow');

async function listFixtureDirs() {
    const entries = await fs.readdir(fixturesDir, { withFileTypes: true });
    return entries
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name)
        .sort();
}

async function runFixture(fixtureName, llmAgent) {
    const fixtureDir = path.join(fixturesDir, fixtureName);
    const specPath = path.join(fixtureDir, 'specs', 'index.mjs.mds');
    const generatedPath = path.join(fixtureDir, 'generated', 'index.mjs');
    const testsPath = path.join(fixtureDir, 'tests.json');

    const specContent = await fs.readFile(specPath, 'utf-8');
    const generatedCode = await fs.readFile(generatedPath, 'utf-8');
    const testsRaw = await fs.readFile(testsPath, 'utf-8');
    const { tests } = JSON.parse(testsRaw);

    if (!Array.isArray(tests) || tests.length === 0) {
        throw new Error(`Fixture ${fixtureName} has no tests.`);
    }

    const specForPrompt = `\n\n---\n# Spec for: index.mjs\n\n${specContent}`;
    const repairedCode = await repairGeneratedFile(
        'index.mjs',
        specForPrompt,
        '',
        generatedCode,
        tests.map(test => ({
            promptText: test.promptText,
            expectedOutput: test.expectedOutput,
            actual: 'N/A',
        })),
        llmAgent,
        'repair-eval-fixture'
    );

    const testResults = await runBehaviorTestsInTemp('index.mjs', repairedCode, tests);
    const failures = testResults.results.filter(result => !result.pass);
    if (failures.length > 0) {
        const summary = failures
            .map(failure => `Input: ${JSON.stringify(failure.promptText)} Expected: ${JSON.stringify(failure.expectedOutput)} Actual: ${JSON.stringify(failure.actual)}`)
            .join(' | ');
        throw new Error(`Repair produced failing tests (${failures.length}/${tests.length}). ${summary}`);
    }
}

async function evalRepairFlow() {
    await envAutoConfig();
    const llmAgent = new LLMAgent({ name: 'evalRepairFlow' });

    const fixtures = await listFixtureDirs();
    if (fixtures.length === 0) {
        throw new Error('No repairFlow fixtures found.');
    }

    let passed = 0;
    let failed = 0;

    for (const fixture of fixtures) {
        const fixtureDir = path.join(fixturesDir, fixture);
        try {
            console.log(`\n=== Repair Flow: ${fixture} ===`);
            await runFixture(fixture, llmAgent);
            console.log(`🟢 ${fixture}: Repaired and executed successfully`);
            passed += 1;
        } catch (error) {
            console.log(`🔴 ${fixture}: ${error.message}`);
            failed += 1;
        } finally {
            const generatedPath = path.join(fixtureDir, 'index.mjs');
            await fs.rm(generatedPath, { force: true }).catch(() => {});
            const backupDir = path.join(fixtureDir, 'specs', '.backup');
            await fs.rm(backupDir, { recursive: true, force: true }).catch(() => {});
        }
    }

    console.log('\n' + '='.repeat(60));
    console.log('📊 REPAIR FLOW SUMMARY');
    console.log('='.repeat(60));
    console.log(`🟢 Passed: ${passed}/${fixtures.length}`);
    console.log(`🔴 Failed: ${failed}/${fixtures.length}`);
    console.log(`📈 Success Rate: ${Math.round((passed / fixtures.length) * 100)}%`);
}

await evalRepairFlow();
