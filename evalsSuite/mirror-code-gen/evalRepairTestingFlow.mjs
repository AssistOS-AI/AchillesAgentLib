import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LLMAgent } from '../../LLMAgents/LLMAgent.mjs';
import { generatePlannedTestsOnDisk } from '../../RecursiveSkilledAgents/mirror-code-generator/testing.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, 'fixtures', 'repairTestingFlow');

function normalizeRelPath(baseDir, filePath) {
    return path.relative(baseDir, filePath).replace(/\\/g, '/');
}

async function readSourceFiles(baseDir) {
    const srcDir = path.join(baseDir, 'src');
    const exists = await fs.stat(srcDir).then(stat => stat.isDirectory()).catch(() => false);
    if (!exists) {
        return new Map();
    }

    const files = new Map();

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
            const rel = normalizeRelPath(baseDir, fullPath);
            const content = await fs.readFile(fullPath, 'utf-8');
            files.set(rel, content);
        }
    }

    await walk(srcDir);
    return files;
}

async function restoreSourceFiles(baseDir, snapshot) {
    for (const [rel, content] of snapshot.entries()) {
        const abs = path.join(baseDir, rel);
        await fs.mkdir(path.dirname(abs), { recursive: true });
        await fs.writeFile(abs, content, 'utf-8');
    }
}

async function cleanupTests(baseDir) {
    const testsDir = path.join(baseDir, 'tests');
    await fs.rm(testsDir, { recursive: true, force: true }).catch(() => {});
}

function countFailures(testResults) {
    if (!testResults || !Array.isArray(testResults.failedTests)) {
        return 0;
    }
    return testResults.failedTests.filter(entry => entry && entry.pass === false).length;
}

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

async function runFixture(fixtureName, llmAgent) {
    const baseDir = path.join(fixturesDir, fixtureName);
    const sourceFiles = await readSourceFiles(baseDir);
    assert(sourceFiles.size > 0, `${fixtureName} has no source files.`);

    const snapshot = new Map(sourceFiles.entries());
    await cleanupTests(baseDir);

    try {
        const initialResults = await generatePlannedTestsOnDisk(baseDir, sourceFiles, llmAgent, {
            logger: console,
            allowRepair: false,
        });

        const initialFailures = countFailures(initialResults);
        assert(initialFailures > 0, `${fixtureName} did not produce initial failures.`);

        const repairedResults = await generatePlannedTestsOnDisk(baseDir, sourceFiles, llmAgent, {
            logger: console,
            allowRepair: true,
        });

        const finalFailures = countFailures(repairedResults);
        assert(finalFailures === 0, `${fixtureName} still has failing tests after repair.`);
    } finally {
        await cleanupTests(baseDir);
        await restoreSourceFiles(baseDir, snapshot);
    }
}

async function evalRepairTestingFlow() {
    const llmAgent = new LLMAgent({ name: 'evalRepairTestingFlow' });
    const fixtures = await fs.readdir(fixturesDir, { withFileTypes: true });
    const caseDirs = fixtures.filter(entry => entry.isDirectory()).map(entry => entry.name).sort();

    let passed = 0;
    let failed = 0;

    for (const fixture of caseDirs) {
        try {
            console.log(`\n=== Repair Testing Flow: ${fixture} ===`);
            await runFixture(fixture, llmAgent);
            console.log(`🟢 ${fixture}: Repaired successfully`);
            passed += 1;
        } catch (error) {
            console.log(`🔴 ${fixture}: ${error.message}`);
            failed += 1;
        }
    }

    console.log('\n' + '='.repeat(60));
    console.log('📊 REPAIR TESTING FLOW SUMMARY');
    console.log('='.repeat(60));
    console.log(`🟢 Passed: ${passed}/${caseDirs.length}`);
    console.log(`🔴 Failed: ${failed}/${caseDirs.length}`);
    console.log(`📈 Success Rate: ${Math.round((passed / caseDirs.length) * 100)}%`);
}

await evalRepairTestingFlow();
