import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LLMAgent } from '../../../LLMAgents/LLMAgent.mjs';
import { action as runTestsGenerator } from '../../../RecursiveSkilledAgents/internalSkills/tests-generator/src/index.mjs';
import { runAllTestsOnDisk } from '../../../RecursiveSkilledAgents/internalSkills/mirror-code-generator/src/index.mjs';

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

function createCaseLogger() {
    const warnings = [];
    const errors = [];
    return {
        warnings,
        errors,
        log: (...args) => console.log(...args),
        warn: (message, ...rest) => {
            warnings.push([message, ...rest].filter(Boolean).join(' '));
        },
        error: (message, ...rest) => {
            errors.push([message, ...rest].filter(Boolean).join(' '));
        },
    };
}

async function runCase({ name, baseDir, llmAgent }) {
    await cleanupTests(baseDir);
    const sourceFiles = await readSourceFiles(baseDir);
    const logger = createCaseLogger();

    await runTestsGenerator({
        prompt: baseDir,
        llmAgent,
        sourceFiles,
        logger,
    });

    const results = await runAllTestsOnDisk(baseDir, logger);
    const testsDir = path.join(baseDir, 'tests');
    const testFiles = (await listTestFiles(testsDir)).filter(file => !file.endsWith('runAll.mjs'));
    const runnerPath = path.join(testsDir, 'runAll.mjs');

    assert(await fs.stat(runnerPath).then(stat => stat.isFile()).catch(() => false), 'runAll.mjs was not created.');
    assert(testFiles.length > 0, 'Expected at least one generated test file.');
    assert(results && Array.isArray(results.failedTests), 'Expected runAll failedTests array.');

    if (logger.warnings.length) {
        const details = logger.warnings.join('; ');
        throw new Error(`Warnings detected during test generation/execution: ${details}`);
    }
    return { warnings: logger.warnings, errors: logger.errors };
}

async function evalTestingFlow() {
    const llmAgent = new LLMAgent({ name: 'evalTestingFlow' });
    const cases = [
        { name: 'case-01-single-math-1' },
        { name: 'case-02-single-math-2' },
        { name: 'case-03-db-adapter-1' },
        { name: 'case-04-db-adapter-2' },
        { name: 'case-05-scraper-mini' },
        { name: 'case-06-calendar-mini' },
    ];

    let passed = 0;
    let failed = 0;

    for (const testCase of cases) {
        try {
            console.log(`\n=== Testing Flow: ${testCase.name} ===`);
            const baseDir = path.join(fixturesDir, testCase.name);
            const { warnings, errors } = await runCase({
                name: testCase.name,
                baseDir,
                llmAgent,
            });
            if (warnings.length) {
                console.log('⚠️  Warnings:');
                for (const warning of warnings) {
                    console.log(`- ${warning}`);
                }
            }
            if (errors.length) {
                console.log('❌ Errors:');
                for (const error of errors) {
                    console.log(`- ${error}`);
                }
            }
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
