import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LLMAgent } from '../../LLMAgents/LLMAgent.mjs';
import {
    generateBehaviorTests,
    repairGeneratedFile,
    runBehaviorTestsOnDisk,
} from '../../RecursiveSkilledAgents/mirror-code-generator/testing.mjs';

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

    const specForPrompt = `\n\n---\n# Spec for: src/index.mjs\n\n${specContent}`;
    const importPath = '../src/index.mjs';
    const { runnerCode } = await generateBehaviorTests(specForPrompt, generatedCode, llmAgent, { importPath });
    const repairedCode = await repairGeneratedFile(
        'src/index.mjs',
        specForPrompt,
        '',
        generatedCode,
        tests.map(test => ({
            input: test.input,
            expectedOutput: test.expectedOutput,
            actual: 'N/A',
        })),
        llmAgent,
        'repair-eval-fixture',
        { runnerCode, tests }
    );

    const outputPath = path.join(fixtureDir, 'src', 'index.mjs');
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, repairedCode, 'utf-8');

    const testResults = await runBehaviorTestsOnDisk(
        fixtureDir,
        'src/index.mjs',
        tests,
        runnerCode,
        { logger: console }
    );
    const failures = testResults.results.filter(result => !result.pass);
    if (failures.length > 0) {
        const summary = failures
            .map(failure => `Input: ${JSON.stringify(failure.input)} Expected: ${JSON.stringify(failure.expectedOutput)} Actual: ${JSON.stringify(failure.actual)}`)
            .join(' | ');
        throw new Error(`Repair produced failing tests (${failures.length}/${tests.length}). ${summary}`);
    }
}

async function evalRepairFlow() {
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
            const srcDir = path.join(fixtureDir, 'src');
            await fs.rm(srcDir, { recursive: true, force: true }).catch(() => {});
            const backupDir = path.join(fixtureDir, 'specs', '.backup');
            await fs.rm(backupDir, { recursive: true, force: true }).catch(() => {});
            const testsDir = path.join(fixtureDir, 'tests');
            await fs.rm(testsDir, { recursive: true, force: true }).catch(() => {});
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
