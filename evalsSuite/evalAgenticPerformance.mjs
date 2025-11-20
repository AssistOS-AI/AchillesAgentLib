import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LLMAgent } from '../LLMAgents/LLMAgent.mjs';
import { envAutoConfig } from '../LLMAgents/envAutoConfig.mjs';

envAutoConfig();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CASES_DIR = path.join(__dirname, 'performanceCases');

const COLORS = {
    RESET: '\x1b[0m',
    RED: '\x1b[31m',
    GREEN: '\x1b[32m',
    YELLOW: '\x1b[33m',
};

// Low-level tools for SOPLang execution
const SOP_TOOLS = {
    add: {
        description: 'Adds two numbers and returns the sum as text.',
        handler: async (a, b) => String(Number(a) + Number(b)),
    },
    multiply: {
        description: 'Multiplies two numbers and returns the product.',
        handler: async (a, b) => String(Number(a) * Number(b)),
    },
    subtract: {
        description: 'Subtracts the second number from the first, result as text.',
        handler: async (a, b) => String(Number(a) - Number(b)),
    },
    divide: {
        description: 'Divides the first number by the second, Infinity if divisor is zero.',
        handler: async (a, b) => {
            const numB = Number(b);
            if (numB === 0) return 'Infinity';
            return String(Number(a) / numB);
        },
    },
    reverse: {
        description: 'Reverses the provided text.',
        handler: async (text) => String(text).split('').reverse().join(''),
    },
    uppercase: {
        description: 'Converts the provided text to uppercase.',
        handler: async (text) => String(text).toUpperCase(),
    },
    lowercase: {
        description: 'Converts the provided text to lowercase.',
        handler: async (text) => String(text).toLowerCase(),
    },
    length: {
        description: 'Returns the character length of the provided text.',
        handler: async (text) => String(String(text).length),
    },
    concat: {
        description: 'Concatenates two strings.',
        handler: async (a, b) => String(a) + String(b),
    },
    isEven: {
        description: 'Returns true if the provided integer is even.',
        handler: async (n) => (Number.parseInt(n, 10) % 2 === 0 ? 'true' : 'false'),
    },
    invert: {
        description: 'Inverts a boolean string (true/false).',
        handler: async (bool) => (String(bool).trim() === 'true' ? 'false' : 'true'),
    },
    extractEmail: {
        description: 'Extracts the first e-mail address from text.',
        handler: async (text) => {
            const match = String(text).match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
            return match ? match[0] : '';
        },
    },
    getDomain: {
        description: 'Extracts the domain portion of an e-mail address.',
        handler: async (email) => {
            const parts = String(email).split('@');
            return parts.length > 1 ? parts[1] : '';
        },
    },
};

const SOP_SKILL_DESCRIPTIONS = Object.fromEntries(
    Object.entries(SOP_TOOLS).map(([name, spec]) => [name, spec.description]),
);

function createSOPCommandsRegistry() {
    return {
        async executeCommand(payload, response) {
            const { command, args } = payload;
            const spec = SOP_TOOLS[command];
            if (!spec) {
                return response.fail(`Unknown command: ${command}`);
            }
            try {
                const value = await spec.handler(...(args ?? []));
                return response.success(value);
            } catch (error) {
                return response.fail(error.message || String(error));
            }
        },
        listCommands: () => Object.entries(SOP_TOOLS).map(([name, spec]) => ({
            name,
            description: spec.description,
        })),
    };
}

// High-level tools for agentic loop sessions
const LOOP_TOOLS = {
    math: {
        description: 'Understands natural language arithmetic problems and returns the numeric result as text.',
        handler: async ({ prompt, agent }) => {
            const instruction = [
                'You are a precise math solver.',
                'Solve the following problem and respond ONLY with the final numeric result.',
                'Do not explain your reasoning. Do not add extra text.',
                '',
                prompt,
            ].join('\n');

            const result = await agent.complete({
                prompt: instruction,
                mode: 'fast',
                context: { intent: 'perf-tool-math' },
            });

            return String(result).trim();
        },
    },
    text: {
        description: 'Performs simple text transformations and returns only the final text.',
        handler: async ({ prompt, agent }) => {
            const instruction = [
                'You are a text utility tool.',
                'Follow the instruction and respond ONLY with the requested text.',
                'Do not add explanations.',
                '',
                prompt,
            ].join('\n');

            const result = await agent.complete({
                prompt: instruction,
                mode: 'fast',
                context: { intent: 'perf-tool-text' },
            });

            return String(result).trim();
        },
    },
    email: {
        description: 'Extracts email addresses or domains from natural language text.',
        handler: async ({ prompt, agent }) => {
            const instruction = [
                'You are an email analysis tool.',
                'Extract the requested email address or domain and respond ONLY with that value.',
                'Do not add explanations.',
                '',
                prompt,
            ].join('\n');

            const result = await agent.complete({
                prompt: instruction,
                mode: 'fast',
                context: { intent: 'perf-tool-email' },
            });

            return String(result).trim();
        },
    },
};

function parseRunsArg() {
    const arg = process.argv[2];
    if (!arg) {
        return 3;
    }
    const n = Number.parseInt(arg, 10);
    if (Number.isNaN(n) || n <= 0) {
        return 3;
    }
    return n;
}

async function loadPerformanceCases() {
    const files = await fs.readdir(CASES_DIR);
    const cases = [];
    for (const file of files.filter((f) => f.endsWith('.json')).sort()) {
        const raw = await fs.readFile(path.join(CASES_DIR, file), 'utf8');
        const parsed = JSON.parse(raw);
        cases.push({
            file,
            id: parsed.id || file.replace(/\.json$/, ''),
            description: parsed.description || '',
            prompt: parsed.prompt || '',
            expected: parsed.expected ?? '',
        });
    }
    return cases;
}

function normalizeValue(value) {
    return String(value ?? '').trim();
}

async function runSOPCase(agent, testCase) {
    const started = Date.now();
    const details = {
        plan: '',
        variables: {},
        matchedVariable: null,
        answer: '',
    };

    try {
        const commandsRegistry = createSOPCommandsRegistry();
        const session = await agent.startSOPLangAgentSession(
            SOP_SKILL_DESCRIPTIONS,
            testCase.prompt,
            { commandsRegistry },
        );
        details.plan = await session.getSOPLangPlan();
        const summary = await session.getVariables();
        details.variables = summary.variables || {};
        details.answer = summary.lastAnswer || details.variables.lastAnswer || '';

        const normalizedExpected = normalizeValue(testCase.expected);
        const match = Object.entries(details.variables).find(([, value]) => normalizeValue(value) === normalizedExpected);

        if (match) {
            details.matchedVariable = match[0];
            details.answer = match[1];
            return {
                ok: true,
                duration: Date.now() - started,
                error: null,
                details,
            };
        }

        return {
            ok: false,
            duration: Date.now() - started,
            error: null,
            details,
        };
    } catch (error) {
        return {
            ok: false,
            duration: Date.now() - started,
            error,
            details,
        };
    }
}

async function runLoopCase(agent, testCase) {
    const started = Date.now();
    const details = { answer: '' };

    try {
        const session = await agent.startLoopAgentSession(LOOP_TOOLS, testCase.prompt, {});
        const summary = (await session.getVariables()) || {};
        details.answer = summary.lastAnswer || '';

        const ok = normalizeValue(details.answer) === normalizeValue(testCase.expected);
        return {
            ok,
            duration: Date.now() - started,
            error: null,
            details,
        };
    } catch (error) {
        return {
            ok: false,
            duration: Date.now() - started,
            error,
            details,
        };
    }
}

function logRunResult(kind, testCase, runIndex, runsPerCase, result, expected) {
    const prefix = `[${kind}] ${testCase.id} run ${runIndex + 1}/${runsPerCase}`;
    if (result.ok) {
        const answer = result.details?.answer ? ` -> "${result.details.answer}"` : '';
        const extra = (kind === 'SOPLang' && result.details?.matchedVariable)
            ? ` (matched @${result.details.matchedVariable})`
            : '';
        console.log(`${COLORS.GREEN}${prefix}: PASS in ${result.duration}ms${answer}${extra}${COLORS.RESET}`);
        return;
    }

    const color = result.error ? COLORS.RED : COLORS.YELLOW;
    const reason = result.error
        ? `ERROR: ${result.error.message || result.error}`
        : `Mismatch. Expected "${expected}", got "${result.details?.answer ?? ''}"`;

    console.log(`${color}${prefix}: ${reason} (${result.duration}ms)${COLORS.RESET}`);

    if (kind === 'SOPLang' && result.details?.plan) {
        console.log('  Generated plan:');
        console.log(result.details.plan);
    }
    if (result.details?.variables && Object.keys(result.details.variables).length && !result.error) {
        console.log('  Variables:', result.details.variables);
    }
}

function updateStats(bucket, result) {
    bucket.runs += 1;
    bucket.totalMs += result.duration;
    if (result.ok) {
        bucket.successMs += result.duration;
    } else {
        bucket.errors += 1;
    }
}

function printCaseHeader(testCase) {
    console.log(`\n===== ${testCase.id} =====`);
    console.log(`Description: ${testCase.description}`);
    console.log(`Prompt: ${testCase.prompt}`);
    console.log(`Expected answer: ${testCase.expected}`);
}

function printFinalSummary(stats, runsPerCase) {
    let sopErrors = 0;
    let loopErrors = 0;
    let sopTotalMs = 0;
    let loopTotalMs = 0;
    let sopSuccessMs = 0;
    let loopSuccessMs = 0;

    for (const s of stats) {
        sopErrors += s.sop.errors;
        loopErrors += s.loop.errors;
        sopTotalMs += s.sop.totalMs;
        loopTotalMs += s.loop.totalMs;
        sopSuccessMs += s.sop.successMs;
        loopSuccessMs += s.loop.successMs;
    }

    const totalRuns = runsPerCase * stats.length;
    const sopOkRuns = totalRuns - sopErrors;
    const loopOkRuns = totalRuns - loopErrors;

    console.log('\n===== AgenticPerformance Summary =====');
    console.log(`Cases: ${stats.length}, runs per case: ${runsPerCase}`);
    console.log(`SOPLang (startSOPLangAgentSession): totalRuns=${totalRuns}, errors=${sopErrors}, totalTime=${sopTotalMs}ms, avgPerRun=${(sopTotalMs / totalRuns).toFixed(1)}ms, avg(ok)=${sopOkRuns ? (sopSuccessMs / sopOkRuns).toFixed(1) : 'n/a'}ms`);
    console.log(`Loop (startLoopAgentSession): totalRuns=${totalRuns}, errors=${loopErrors}, totalTime=${loopTotalMs}ms, avgPerRun=${(loopTotalMs / totalRuns).toFixed(1)}ms, avg(ok)=${loopOkRuns ? (loopSuccessMs / loopOkRuns).toFixed(1) : 'n/a'}ms`);
}

async function main() {
    const runsPerCase = parseRunsArg();
    console.log(`[AgenticPerformance] Runs per case: ${runsPerCase}`);

    const agent = new LLMAgent({ name: 'AgenticPerformance' });
    const cases = await loadPerformanceCases();

    if (!cases.length) {
        console.log('No performance cases found.');
        return;
    }

    const stats = cases.map((testCase) => ({
        id: testCase.id,
        description: testCase.description,
        expected: testCase.expected,
        sop: {
            runs: 0,
            errors: 0,
            totalMs: 0,
            successMs: 0,
        },
        loop: {
            runs: 0,
            errors: 0,
            totalMs: 0,
            successMs: 0,
        },
    }));

    for (let i = 0; i < cases.length; i += 1) {
        const testCase = cases[i];
        const stat = stats[i];

        printCaseHeader(testCase);

        for (let run = 0; run < runsPerCase; run += 1) {
            // SOPLang plan + execution
            // eslint-disable-next-line no-await-in-loop
            const sopResult = await runSOPCase(agent, testCase);
            logRunResult('SOPLang', testCase, run, runsPerCase, sopResult, testCase.expected);
            updateStats(stat.sop, sopResult);

            // Loop agent session
            // eslint-disable-next-line no-await-in-loop
            const loopResult = await runLoopCase(agent, testCase);
            logRunResult('Loop', testCase, run, runsPerCase, loopResult, testCase.expected);
            updateStats(stat.loop, loopResult);
        }
    }

    printFinalSummary(stats, runsPerCase);
}

main().catch((err) => {
    console.error('[AgenticPerformance] Fatal error:', err);
    process.exit(1);
});
