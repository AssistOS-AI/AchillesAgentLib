import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LLMAgent } from '../../../LLMAgents/LLMAgent.mjs';
import { action as runFdsAction } from '../../../RecursiveSkilledAgents/internalSkills/fds-generator/src/index.mjs';
import {
    getAffectedFilesSection,
    getExportsSection,
    parseDsExportsList,
    parseExportsList,
} from '../../../RecursiveSkilledAgents/internalSkills/fds-generator/src/SpecsManager.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, 'fixtures');

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

async function ensureCleanSpecs(baseDir) {
    const specsDir = path.join(baseDir, 'specs');
    const fdsDir = path.join(baseDir, 'fds');
    await fs.rm(specsDir, { recursive: true, force: true }).catch(() => {});
    await fs.rm(fdsDir, { recursive: true, force: true }).catch(() => {});
}

const CASES = [
    {
        name: 'case-01-math-algorithm',
        expected: [
            'specs/FDS_math-core.md',
        ],
    },
    {
        name: 'case-02-text-search',
        expected: [
            'specs/FDS_search-engine.md',
            'specs/FDS_sentence-matcher.md',
            'specs/FDS_query-parser.md',
        ],
    },
    {
        name: 'case-03-cli-assistant',
        expected: [
            'specs/cli/CommandSurface.mjs.md',
            'specs/orchestration/PromptOrchestrator.mjs.md',
            'specs/llm/ProviderGateway.mjs.md',
            'specs/system/SystemContextProfile.mjs.md',
            'specs/guidance/GuidanceComposer.mjs.md',
        ],
    },
    {
        name: 'case-04-orchestrated-platform',
        expected: [
            'specs/catalog/EquipmentCatalog.mjs.md',
            'specs/catalog/MaterialCatalog.mjs.md',
            'specs/jobs/JobAssignmentService.mjs.md',
            'specs/jobs/AvailabilityIndex.mjs.md',
            'specs/ui/SearchAndFilterPanel.mjs.md',
        ],
    },
];

async function runCase(testCase, llmAgent) {
    const baseDir = path.join(fixturesDir, testCase.name);
    await ensureCleanSpecs(baseDir);

    const result = await runFdsAction({
        prompt: baseDir,
        llmAgent,
        logger: console,
    });

    assert(!result?.skipped, `${testCase.name}: expected FDS generation to run.`);

    for (const relPath of testCase.expected) {
        const targetPath = path.join(baseDir, relPath);
        const exists = await fs.stat(targetPath).then(stat => stat.isFile()).catch(() => false);
        assert(exists, `${testCase.name}: expected FDS file ${relPath} to exist.`);
    }

    const dsExportExpected = new Map();
    const dsFiles = await fs.readdir(baseDir);
    const dsNames = dsFiles.filter(name => name.startsWith('DS') && name.endsWith('.md'));
    for (const dsName of dsNames) {
        const dsPath = path.join(baseDir, dsName);
        const affectedFilesSection = await getAffectedFilesSection(dsPath);
        const entries = parseDsExportsList(affectedFilesSection);
        for (const entry of entries) {
            if (!entry?.path || !entry?.exports?.length) continue;
            const normalizedPath = entry.path.replace(/^[.][\/]/, '');
            const existing = dsExportExpected.get(normalizedPath) || new Set();
            for (const exportName of entry.exports) {
                existing.add(exportName);
            }
            dsExportExpected.set(normalizedPath, existing);
        }
    }

    for (const relPath of testCase.expected) {
        if (!relPath.startsWith('specs/')) continue;
        const expectedExports = dsExportExpected.get(relPath);
        if (!expectedExports || expectedExports.size === 0) continue;

        const fdsPath = path.join(baseDir, relPath);
        const exportsSection = await getExportsSection(fdsPath);
        const fdsExports = new Set(parseExportsList(exportsSection));
        for (const exportName of expectedExports) {
            assert(
                fdsExports.has(exportName),
                `${testCase.name}: expected ${relPath} exports to include ${exportName}.`
            );
        }
    }

    return baseDir;
}

async function evalFdsGeneration() {
    const llmAgent = new LLMAgent({ name: 'evalFdsGeneration' });
    let passed = 0;
    let failed = 0;

    for (const testCase of CASES) {
        const baseDir = path.join(fixturesDir, testCase.name);
        try {
            console.log(`\n=== FDS Generation: ${testCase.name} ===`);
            await runCase(testCase, llmAgent);
            console.log(`🟢 ${testCase.name}: Passed`);
            passed += 1;
        } catch (error) {
            console.log(`🔴 ${testCase.name}: ${error.message}`);
            failed += 1;
        } finally {
            await ensureCleanSpecs(baseDir);
        }
    }

    console.log('\n' + '='.repeat(60));
    console.log('📊 FDS GENERATION SUMMARY');
    console.log('='.repeat(60));
    console.log(`🟢 Passed: ${passed}/${CASES.length}`);
    console.log(`🔴 Failed: ${failed}/${CASES.length}`);
    console.log(`📈 Success Rate: ${Math.round((passed / CASES.length) * 100)}%`);
}

await evalFdsGeneration();
