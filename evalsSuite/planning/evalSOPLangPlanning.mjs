import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LLMAgent } from '../../LLMAgents/LLMAgent.mjs';
import { envAutoConfig } from '../../LLMAgents/envAutoConfig.mjs';
import { createCommandsRegistry } from './utils/sopTestCommands.mjs';

envAutoConfig();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CASES_DIR = path.join(__dirname, 'onlySOPLangPlan');

const COLORS = {
    RESET: '\x1b[0m',
    RED: '\x1b[31m',
    GREEN: '\x1b[32m',
    YELLOW: '\x1b[33m',
};

function buildPromptList(caseData) {
    if (Array.isArray(caseData.prompts) && caseData.prompts.length) {
        return caseData.prompts;
    }
    if (caseData.prompt) {
        return [caseData.prompt];
    }
    throw new Error('Case is missing prompt text.');
}

function evaluateOutputs(expectedOutput = {}, variables = {}, lastAnswer = null) {
    const entries = Object.entries(expectedOutput);
    if (!entries.length) {
        return { ok: true, missing: [] };
    }
    const missing = [];
    for (const [key, expectedValue] of entries) {
        const normalizedExpected = String(expectedValue);
        if (Object.prototype.hasOwnProperty.call(variables, key)) {
            if (String(variables[key]) !== normalizedExpected) {
                missing.push({ key, expected: expectedValue, actual: variables[key] });
            }
            continue;
            // eslint-disable-next-line no-else-return
        } else if (key === 'lastAnswer') {
            if (String(lastAnswer ?? '') !== normalizedExpected) {
                missing.push({ key, expected: expectedValue, actual: lastAnswer });
            }
            continue;
        }
        if (String(lastAnswer ?? '') === normalizedExpected) {
            continue;
        }
        missing.push({ key, expected: expectedValue, actual: variables[key] });
    }
    return { ok: missing.length === 0, missing };
}

async function runCase(agent, caseFile, caseData) {
    const prompts = buildPromptList(caseData);
    const skillDescriptions = caseData.tools || {};
    const commandsRegistry = createCommandsRegistry(skillDescriptions);

    const session = await agent.startSOPLangAgentSession(skillDescriptions, prompts[0], {
        planOnly: false,
        commandsRegistry,
    });
    for (let i = 1; i < prompts.length; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await session.newPrompt(prompts[i]);
    }

    const summary = await session.getVariables();
    const variables = summary?.variables || {};
    const lastAnswer = summary?.lastAnswer ?? null;

    const evaluation = evaluateOutputs(caseData.expectedOutput, variables, lastAnswer);
    if (!evaluation.ok) {
        console.log(`${COLORS.RED}❌ ${caseFile} failed expectations.${COLORS.RESET}`);
        evaluation.missing.forEach((entry) => {
            console.log(`${COLORS.YELLOW}- Expected ${entry.key} = ${entry.expected}${COLORS.RESET}`);
            console.log(`${COLORS.RED}  Actual: ${entry.actual ?? '(missing)'}${COLORS.RESET}`);
        });
        return false;
    }

    console.log(`${COLORS.GREEN}✅ ${caseFile} produced the expected output.${COLORS.RESET}`);
    return true;
}

async function main() {
    console.log('Hint: run with --help to see available options.');
    const args = process.argv.slice(2);
    if (args.includes('--help') || args.includes('-h')) {
        console.log([
            'Usage: node evalsSuite/planning/evalSOPLangPlanning.mjs',
            '',
            'Runs full startSOPLangAgentSession flows (with the interpreter) using the cases in',
            'evalsSuite/planning/onlySOPLangPlan and validates the resulting variables/lastAnswer',
            'against the expectedOutput block declared in each case file.',
        ].join('\n'));
        return;
    }

    const agent = new LLMAgent({ name: 'SOPSessionExecutor' });

    const files = (await fs.readdir(CASES_DIR))
        .filter((name) => name.endsWith('.json'))
        .sort();

    if (!files.length) {
        console.log('No SOP execution cases found.');
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

    console.log('\n=== SOP Session Execution Summary ===');
    console.log(`Passed ${passed}/${files.length} cases.`);
}

main().catch((error) => {
    console.error('[evalSOPLangPlanning] Fatal error:', error);
    process.exit(1);
});
