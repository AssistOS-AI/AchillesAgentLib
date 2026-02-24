import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LLMAgent } from '../../LLMAgents/LLMAgent.mjs';
import {
    ensureRunAllTemplate,
    generatePlannedTestsOnDisk,
    generateTestPlans,
    runAllTestsOnDisk,
} from '../../RecursiveSkilledAgents/mirror-code-generator/testing.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, 'fixtures', 'testingFlow');

function normalizeRelPath(baseDir, filePath) {
    return path.relative(baseDir, filePath).replace(/\\/g, '/');
}

async function readSourceFiles(baseDir) {
    const srcDir = path.join(baseDir, 'src');
    const entries = await fs.stat(srcDir).then(() => true).catch(() => false);
    if (!entries) {
        return new Map();
    }

    const files = new Map();

    async function walk(dir) {
        const dirEntries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of dirEntries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                await walk(fullPath);
                continue;
            }
            if (!entry.isFile()) {
                continue;
            }
            if (!entry.name.endsWith('.mjs') && !entry.name.endsWith('.js')) {
                continue;
            }
            const rel = normalizeRelPath(baseDir, fullPath);
            const content = await fs.readFile(fullPath, 'utf-8');
            files.set(rel, content);
        }
    }

    await walk(srcDir);
    return files;
}

async function listTestFiles(testsDir) {
    const exists = await fs.stat(testsDir).then(stat => stat.isDirectory()).catch(() => false);
    if (!exists) {
        return [];
    }

    const files = [];
    async function walk(dir) {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                await walk(fullPath);
                continue;
            }
            if (!entry.isFile()) {
                continue;
            }
            if (!entry.name.endsWith('.mjs') && !entry.name.endsWith('.js')) {
                continue;
            }
            files.push(fullPath);
        }
    }

    await walk(testsDir);
    return files;
}

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

async function cleanupTests(baseDir) {
    const testsDir = path.join(baseDir, 'tests');
    await fs.rm(testsDir, { recursive: true, force: true }).catch(() => {});
}

async function case01_singleMathPlan(llmAgent) {
    const baseDir = path.join(fixturesDir, 'case-01-single-math-1');
    const sourceFiles = await readSourceFiles(baseDir);
    assert(sourceFiles.size === 1, 'case-01 should have exactly one source file.');

    const plans = await generateTestPlans(sourceFiles, llmAgent, {
        testingInstructions: 'Create a focused plan for the single module.',
        intent: 'eval-test-plan-single-file',
        errorLabel: 'Eval test plan generation',
    });

    assert(plans.length > 0, 'Expected at least one test plan.');
    const plan = plans[0];
    assert(plan.sourceFiles.length === 1, 'Expected single-file plan for case-01.');
}

async function case02_emptyTestCases() {
    const baseDir = path.join(fixturesDir, 'case-02-single-math-2');
    await cleanupTests(baseDir);

    class StubAgent {
        async executePrompt(_prompt, { context } = {}) {
            if (context?.intent === 'generate-test-plans') {
                return {
                    testPlans: [
                        {
                            description: 'Test square function with a small numeric input.',
                            sourceFiles: ['src/index.mjs'],
                        },
                    ],
                };
            }
            if (context?.intent === 'generate-test-file') {
                return {
                    fileName: 'nested/empty.test.mjs',
                    content: "const results = [{ pass: true }];\nprocess.stdout.write(JSON.stringify({ results }));",
                    testCases: {},
                };
            }
            throw new Error('Unexpected prompt in stub agent.');
        }
    }

    const stubAgent = new StubAgent();
    const sourceFiles = await readSourceFiles(baseDir);
    const results = await generatePlannedTestsOnDisk(baseDir, sourceFiles, stubAgent, { logger: console });

    const testsDir = path.join(baseDir, 'tests');
    const testFilePath = path.join(testsDir, 'nested', 'empty.test.mjs');
    const casesPath = `${testFilePath}.cases.json`;

    assert(await fs.stat(testFilePath).then(stat => stat.isFile()).catch(() => false), 'Expected stub test file to be written.');
    assert(!(await fs.stat(casesPath).then(stat => stat.isFile()).catch(() => false)), 'Did not expect .cases.json to be written.');
    assert(results && Array.isArray(results.failedTests), 'Expected runAll failedTests array for stub tests.');
}

async function case03_crossFilePlan(llmAgent) {
    const baseDir = path.join(fixturesDir, 'case-03-db-adapter-1');
    const sourceFiles = await readSourceFiles(baseDir);
    assert(sourceFiles.size >= 3, 'case-03 requires at least three source files.');

    const plans = await generateTestPlans(sourceFiles, llmAgent, {
        testingInstructions: 'Create cross-file plans when behavior spans modules.',
        intent: 'eval-test-plan-cross-file',
        errorLabel: 'Eval test plan generation',
    });

    const crossPlan = plans.find(plan => Array.isArray(plan.sourceFiles) && plan.sourceFiles.length >= 2);
    assert(crossPlan, 'Expected at least one cross-file plan.');

    const missing = crossPlan.sourceFiles.filter(file => !sourceFiles.has(file));
    assert(missing.length === 0, `Plan references missing source files: ${missing.join(', ')}`);
}

async function case04_runAllRecursive() {
    const baseDir = path.join(fixturesDir, 'case-04-db-adapter-2');
    await cleanupTests(baseDir);

    const testsDir = path.join(baseDir, 'tests');
    await fs.mkdir(path.join(testsDir, 'unit'), { recursive: true });
    await fs.writeFile(
        path.join(testsDir, 'unit', 'alpha.mjs'),
        "const results = [{ pass: true }];\nprocess.stdout.write(JSON.stringify({ results }));",
        'utf-8'
    );
    await fs.writeFile(
        path.join(testsDir, 'beta.js'),
        "const results = [{ pass: true }];\nprocess.stdout.write(JSON.stringify({ results }));",
        'utf-8'
    );

    await ensureRunAllTemplate(baseDir, console);
    const results = await runAllTestsOnDisk(baseDir, console);

    assert(results && Array.isArray(results.failedTests), 'Expected runAll failedTests array.');
    const files = results.failedTests.map(entry => entry.file).sort();
    assert(files.some(file => file.includes('unit/alpha.mjs')), 'runAll did not include nested test file.');
    assert(files.some(file => file.endsWith('beta.js')), 'runAll did not include top-level test file.');
}

async function case05_fullFlow(llmAgent) {
    const baseDir = path.join(fixturesDir, 'case-05-scraper-mini');
    await cleanupTests(baseDir);

    const sourceFiles = await readSourceFiles(baseDir);
    const results = await generatePlannedTestsOnDisk(baseDir, sourceFiles, llmAgent, { logger: console });

    const testsDir = path.join(baseDir, 'tests');
    const testFiles = (await listTestFiles(testsDir)).filter(file => !file.endsWith('runAll.mjs'));
    const runnerPath = path.join(testsDir, 'runAll.mjs');

    assert(await fs.stat(runnerPath).then(stat => stat.isFile()).catch(() => false), 'runAll.mjs was not created.');
    assert(testFiles.length > 0, 'Expected at least one generated test file in full flow.');
    assert(results && Array.isArray(results.failedTests), 'Expected runAll failedTests array in full flow.');
}

async function case06_fullFlow(llmAgent) {
    const baseDir = path.join(fixturesDir, 'case-06-calendar-mini');
    await cleanupTests(baseDir);

    const sourceFiles = await readSourceFiles(baseDir);
    const results = await generatePlannedTestsOnDisk(baseDir, sourceFiles, llmAgent, { logger: console });

    const testsDir = path.join(baseDir, 'tests');
    const testFiles = (await listTestFiles(testsDir)).filter(file => !file.endsWith('runAll.mjs'));
    const runnerPath = path.join(testsDir, 'runAll.mjs');

    assert(await fs.stat(runnerPath).then(stat => stat.isFile()).catch(() => false), 'runAll.mjs was not created.');
    assert(testFiles.length > 0, 'Expected at least one generated test file in full flow.');
    assert(results && Array.isArray(results.failedTests), 'Expected runAll failedTests array in full flow.');
}

async function evalTestingFlow() {
    const llmAgent = new LLMAgent({ name: 'evalTestingFlow' });
    const cases = [
        { name: 'case-01-single-math-1', fn: () => case01_singleMathPlan(llmAgent) },
        { name: 'case-02-single-math-2', fn: () => case02_emptyTestCases() },
        { name: 'case-03-db-adapter-1', fn: () => case03_crossFilePlan(llmAgent) },
        { name: 'case-04-db-adapter-2', fn: () => case04_runAllRecursive() },
        { name: 'case-05-scraper-mini', fn: () => case05_fullFlow(llmAgent) },
        { name: 'case-06-calendar-mini', fn: () => case06_fullFlow(llmAgent) },
    ];

    let passed = 0;
    let failed = 0;

    for (const testCase of cases) {
        try {
            console.log(`\n=== Testing Flow: ${testCase.name} ===`);
            await testCase.fn();
            console.log(`🟢 ${testCase.name}: Passed`);
            passed += 1;
        } catch (error) {
            console.log(`🔴 ${testCase.name}: ${error.message}`);
            failed += 1;
        } finally {
            const baseDir = path.join(fixturesDir, testCase.name);
            await cleanupTests(baseDir);
        }
    }

    console.log('\n' + '='.repeat(60));
    console.log('📊 TESTING FLOW SUMMARY');
    console.log('='.repeat(60));
    console.log(`🟢 Passed: ${passed}/${cases.length}`);
    console.log(`🔴 Failed: ${failed}/${cases.length}`);
    console.log(`📈 Success Rate: ${Math.round((passed / cases.length) * 100)}%`);
}

await evalTestingFlow();
