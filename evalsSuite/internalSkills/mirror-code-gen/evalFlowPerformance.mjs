import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LLMAgent } from '../../../LLMAgents/LLMAgent.mjs';
import { generateMirrorCode } from '../../../RecursiveSkilledAgents/internalSkills/mirror-code-generator/src/index.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, 'flow-fixtures');

function createLogger() {
    const warnings = [];
    const errors = [];

    const logger = {
        log: () => {},
        warn: (message) => warnings.push(String(message)),
        error: (message) => errors.push(String(message)),
    };

    return { logger, warnings, errors };
}

async function evalFlowPerformance() {
    const llmAgent = new LLMAgent({ name: 'evalFlowPerformance' });
    const fixtureEntries = await fs.readdir(fixturesDir, { withFileTypes: true });
    const fixtureNames = fixtureEntries.filter(entry => entry.isDirectory()).map(entry => entry.name).sort();

    const summary = {
        total: 0,
        clean: 0,
        warnings: 0,
        failed: 0,
        results: [],
    };

    for (const fixtureName of fixtureNames) {
        const fixtureDir = path.join(fixturesDir, fixtureName);
        summary.total += 1;
        const { logger, warnings, errors } = createLogger();
        let status = 'clean';
        let message = 'Flow completed without warnings.';

        try {
            await generateMirrorCode(fixtureDir, llmAgent, logger);
            if (errors.length > 0) {
                status = 'failed';
                message = errors.join('\n');
            } else if (warnings.length > 0) {
                status = 'warnings';
                message = warnings.join('\n');
            }
        } catch (error) {
            status = 'failed';
            message = error?.message ? String(error.message) : 'Unknown error';
        }

        if (status === 'clean') summary.clean += 1;
        if (status === 'warnings') summary.warnings += 1;
        if (status === 'failed') summary.failed += 1;

        summary.results.push({ fixtureName, status, message });
        const icon = status === 'clean' ? '🟢' : status === 'warnings' ? '🟡' : '🔴';
        console.log(`\n${icon} ${fixtureName}: ${status}`);
        if (status !== 'clean') {
            console.log(message);
        }

        await fs.rm(path.join(fixtureDir, 'specs'), { recursive: true, force: true }).catch(() => {});
        await fs.rm(path.join(fixtureDir, 'src'), { recursive: true, force: true }).catch(() => {});
        await fs.rm(path.join(fixtureDir, 'tests'), { recursive: true, force: true }).catch(() => {});
    }

    console.log('\n' + '='.repeat(60));
    console.log('📊 MIRROR CODE-GEN FLOW SUMMARY');
    console.log('='.repeat(60));
    console.log(`🟢 Clean: ${summary.clean}/${summary.total}`);
    console.log(`🟡 Warnings: ${summary.warnings}/${summary.total}`);
    console.log(`🔴 Failed: ${summary.failed}/${summary.total}`);

    const successRate = summary.total > 0
        ? Math.round((summary.clean / summary.total) * 100)
        : 0;
    console.log(`📈 Clean Rate: ${successRate}%`);
}

await evalFlowPerformance();
