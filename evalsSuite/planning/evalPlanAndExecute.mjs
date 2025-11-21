import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LLMAgent } from '../../LLMAgents/LLMAgent.mjs';
import { envAutoConfig } from '../../LLMAgents/envAutoConfig.mjs';

envAutoConfig();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CASES_DIR = path.join(__dirname, 'startSOPLangAgentSession');

const COLORS = {
    RESET: '\x1b[0m',
    RED: '\x1b[31m',
    GREEN: '\x1b[32m',
    YELLOW: '\x1b[33m',
};

function normalizePlan(source) {
    if (!source || typeof source !== 'string') {
        return '';
    }
    return source
        .replace(/\r\n/g, '\n')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length)
        .join('\n')
        .trim();
}

function buildPromptList(caseData) {
    if (Array.isArray(caseData.prompts) && caseData.prompts.length) {
        return caseData.prompts;
    }
    if (caseData.prompt) {
        return [caseData.prompt];
    }
    throw new Error('Case is missing prompt text.');
}

async function runCase(agent, caseFile, caseData) {
    const skillDescriptions = caseData.tools || {};
    const prompts = buildPromptList(caseData);
    const expected = normalizePlan(caseData.expectedPlan);
    if (!expected) {
        throw new Error('Case is missing expectedPlan text.');
    }

    const session = await agent.startSOPLangAgentSession(skillDescriptions, prompts[0], {
        planOnly: true,
    });
    for (let i = 1; i < prompts.length; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await session.newPrompt(prompts[i]);
    }

    const actualPlan = await session.getSOPLangPlan();
    const normalizedActual = normalizePlan(actualPlan);
    const ok = normalizedActual === expected;

    if (!ok) {
        console.log(`${COLORS.RED}❌ ${caseFile} did not match the expected plan.${COLORS.RESET}`);
        console.log(`${COLORS.YELLOW}Expected:\n${caseData.expectedPlan}${COLORS.RESET}`);
        console.log(`${COLORS.RED}Actual:\n${actualPlan}${COLORS.RESET}`);
    } else {
        console.log(`${COLORS.GREEN}✅ ${caseFile} plan matched the expectation.${COLORS.RESET}`);
    }

    return ok;
}

async function main() {
    console.log('Hint: run with --help to see available options.');
    const args = process.argv.slice(2);
    if (args.includes('--help') || args.includes('-h')) {
        console.log([
            'Usage: node evalsSuite/planning/evalPlanAndExecute.mjs',
            '',
            'Tests LightSOPLang plan generation (planOnly mode) by comparing the emitted plan text',
            'against the expected templates stored in evalsSuite/planning/startSOPLangAgentSession.',
        ].join('\n'));
        return;
    }

    const agent = new LLMAgent({ name: 'SOPPlanEvaluator' });

    const files = (await fs.readdir(CASES_DIR))
        .filter((name) => name.endsWith('.json'))
        .sort();

    if (!files.length) {
        console.log('No SOP plan cases found.');
        return;
    }

    let passed = 0;
    for (const file of files) {
        const raw = await fs.readFile(path.join(CASES_DIR, file), 'utf8');
        const caseData = JSON.parse(raw);
        const success = await runCase(agent, file, caseData);
        if (success) {
            passed += 1;
        }
    }

    console.log('\n=== Plan Comparison Summary ===');
    console.log(`Passed ${passed}/${files.length} cases.`);
}

main().catch((error) => {
    console.error('[evalPlanAndExecute] Fatal error:', error);
    process.exit(1);
});
