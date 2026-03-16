import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fork } from 'node:child_process';
import readline from 'node:readline';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CASES_DIR = path.join(__dirname, 'performanceCases');
import { PERFORMANCE_TOOLS } from './tools/allTools.mjs';

const { LLMAgent } = await import('../LLMAgents/LLMAgent.mjs');

const COLORS = {
    RESET: '\x1b[0m',
    RED: '\x1b[31m',
    LIGHT_RED: '\x1b[91m',
    GREEN: '\x1b[32m',
    YELLOW: '\x1b[33m',
};

const SESSION_LABELS = {
    sop: 'SOPLang',
    loop: 'Loop',
};

let lastStatusLength = 0;
function writeProgress(text) {
    const safe = text || '';
    if (process.stdout.isTTY) {
        readline.cursorTo(process.stdout, 0);
        readline.clearLine(process.stdout, 0);
        process.stdout.write(safe);
    } else {
        // Best-effort overwrite when stdout is not a TTY.
        process.stdout.write(`\r${safe}`);
    }
    lastStatusLength = safe.length;
}

function clearProgressLine() {
    if (!lastStatusLength) {
        return;
    }
    if (process.stdout.isTTY) {
        readline.cursorTo(process.stdout, 0);
        readline.clearLine(process.stdout, 0);
    } else {
        process.stdout.write('\r');
    }
    lastStatusLength = 0;
}

function startProgress(label) {
    const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    let idx = 0;
    let lastMessage = '';
    const started = Date.now();
    const timer = setInterval(() => {
        const elapsed = Date.now() - started;
        const frame = frames[idx % frames.length];
        idx += 1;
        const suffix = lastMessage ? ` | ${lastMessage}` : '';
        writeProgress(`${frame} ${label} ... ${elapsed}ms${suffix}`);
    }, 150);
    return {
        stop: () => {
            clearInterval(timer);
            clearProgressLine();
        },
        setMessage: (msg) => {
            if (typeof msg !== 'string') {
                return;
            }
            const trimmed = msg.trim().replace(/\s+/g, ' ');
            lastMessage = trimmed.length > 0 ? trimmed.slice(0, 120) : '';
        },
    };
}

// Low-level tools for SOPLang execution


const SOP_SKILL_DESCRIPTIONS = Object.fromEntries(
    Object.entries(PERFORMANCE_TOOLS).map(([name, spec]) => [name, spec.description]),
);

function createSOPCommandsRegistry(agent) {
    if (agent) {
        if (agent.__toolState instanceof Map) {
            agent.__toolState.clear();
        } else {
            agent.__toolState = new Map();
        }
    }
    return {
        async executeCommand(payload, response) {
            const { command, args } = payload;
            // eslint-disable-next-line no-console
            console.log(`[SOP executeCommand] command=${command}, args=${JSON.stringify(args)}`);
            const spec = PERFORMANCE_TOOLS[command];
            if (!spec) {
                return response.fail(`Unknown command: ${command}`);
            }
            const prompt = Array.isArray(args)
                ? args.map((v) => (v === null || v === undefined ? '' : String(v))).join(' ')
                : (args === null || args === undefined ? '' : String(args));
            try {
                const value = await spec.handler(agent, prompt);
                return response.success(value);
            } catch (error) {
                return response.fail(error.message || String(error));
            }
        },
        listCommands: () => Object.entries(PERFORMANCE_TOOLS).map(([name, spec]) => ({
            name,
            description: spec.description,
        })),
    };
}



function parseArgs() {
    const args = process.argv.slice(2);
    let times = 1;

    if (args.includes('--help') || args.includes('-h')) {
        // eslint-disable-next-line no-console
        console.log([
            'Usage: node evalsSuite/evalAgenticPerformance.mjs [--times N] [--case N]',
            '',
            'Options:',
            '  --times, -t <N>    Run each case N times (default: 1)',
            '  --case, -c <N>     Run only case number N (e.g. 1 for case_01)',
            '  --help, -h         Show this help message',
        ].join('\n'));
        process.exit(0);
    }

    let caseNum = null;

    for (let i = 0; i < args.length; i += 1) {
        const arg = args[i];
        if (arg === '--runs' || arg === '-r' || arg === '--times' || arg === '-t') {
            const next = args[i + 1];
            const parsed = Number.parseInt(next, 10);
            if (Number.isFinite(parsed) && parsed > 0) {
                times = parsed;
                i += 1;
            }
        } else if (arg === '--case' || arg === '-c') {
            const next = args[i + 1];
            const parsed = Number.parseInt(next, 10);
            if (Number.isFinite(parsed) && parsed > 0) {
                caseNum = parsed;
                i += 1;
            }
        } else {
            const parsed = Number.parseInt(arg, 10);
            if (Number.isFinite(parsed) && parsed > 0) {
                times = parsed;
            }
        }
    }

    return { times, caseNum };
}

async function loadPerformanceCaseFromFile(filePath) {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    const systemPrompt = parsed.systemPrompt || '';
    const description = parsed.systemPrompt || parsed.description || '';
    const steps = Array.isArray(parsed.steps) ? parsed.steps : [];
    const normalizedSteps = steps.length
        ? steps
        : [{
            prompt: parsed.prompt || '',
            expected: parsed.expected ?? '',
        }];

    return {
        file: path.basename(filePath),
        id: parsed.id || path.basename(filePath).replace(/\.json$/, ''),
        description,
        systemPrompt,
        steps: normalizedSteps.map((step, index) => ({
            prompt: step.prompt || '',
            expected: step.expected ?? '',
            id: step.id || `step_${index + 1}`,
        })),
    };
}

async function loadPerformanceCases() {
    const files = await fs.readdir(CASES_DIR);
    const cases = [];
    for (const file of files.filter((f) => f.endsWith('.json')).sort()) {
        const caseData = await loadPerformanceCaseFromFile(path.join(CASES_DIR, file));
        cases.push(caseData);
    }
    return cases;
}

function normalizeValue(value) {
    return String(value ?? '').trim().toLowerCase();
}

function charsToTokens(chars) {
    return Math.ceil((chars || 0) / 4);
}

function formatBytesFromChars(chars) {
    const bytes = chars || 0;
    if (bytes >= 1_048_576) {
        return `${(bytes / 1_048_576).toFixed(2)} MB`;
    }
    if (bytes >= 1024) {
        return `${(bytes / 1024).toFixed(2)} KB`;
    }
    return `${bytes} B`;
}

async function evaluateSOPStep(session, step) {
    const answer = session.getLastResult();
    const normalizedExpected = normalizeValue(step.expected);
    const normalizedAnswer = normalizeValue(answer);
    const ok = normalizedExpected ? normalizedExpected === normalizedAnswer : false;

    const plan = typeof session.getPlan === 'function'
        ? await session.getPlan()
        : '';
 
    return {
        ok,
        expected: step.expected,
        answer: answer ?? '',
        variables: {}, // No longer tracking internal variables for validation
        plan,
    };
}

async function runSOPCase(testCase, runIndex, onProgress = () => { }) {
    const started = Date.now();
    const agent = new LLMAgent({ name: `SOP-${testCase.id}-run${runIndex + 1}` });
    const stepResults = [];

    try {
        const steps = testCase.steps || [];
        if (!steps.length) {
            throw new Error('No steps defined for case.');
        }
        const commandsRegistry = createSOPCommandsRegistry(agent);
        const session = await agent.startSOPLangAgentSession(
            SOP_SKILL_DESCRIPTIONS,
            steps[0].prompt,
            { commandsRegistry, systemPrompt: testCase.systemPrompt },
        );

        onProgress(`SOP: ${steps[0].id || 'step1'}`);
        // Evaluate initial prompt
        // eslint-disable-next-line no-await-in-loop
        stepResults.push(await evaluateSOPStep(session, steps[0]));
        for (let i = 1; i < steps.length; i += 1) {
            onProgress(`SOP: ${steps[i].id || `step${i + 1}`}`);
            // eslint-disable-next-line no-await-in-loop
            await session.newPrompt(steps[i].prompt);
            // eslint-disable-next-line no-await-in-loop
            stepResults.push(await evaluateSOPStep(session, steps[i]));
        }

        const ok = stepResults.every((step) => step.ok);
        return {
            ok,
            durationMs: Date.now() - started,
            inputChars: agent.getInputCounter(),
            outputChars: agent.getOutputCounter(),
            steps: stepResults,
            error: null,
        };
    } catch (error) {
        return {
            ok: false,
            durationMs: Date.now() - started,
            inputChars: agent.getInputCounter(),
            outputChars: agent.getOutputCounter(),
            steps: stepResults,
            error: error?.message || String(error),
        };
    }
}

async function evaluateLoopStep(session, step) {
    const answer = session.getLastResult();
    const normalizedExpected = normalizeValue(step.expected);
    const normalizedAnswer = normalizeValue(answer);
    const ok = normalizedExpected ? normalizedExpected === normalizedAnswer : false;
    return {
        ok,
        expected: step.expected,
        answer: answer ?? '',
        variables: {},
    };
}

async function runLoopCase(testCase, runIndex, onProgress = () => { }) {
    const started = Date.now();
    const agent = new LLMAgent({ name: `Loop-${testCase.id}-run${runIndex + 1}` });
    const stepResults = [];

    try {
        const steps = testCase.steps || [];
        if (!steps.length) {
            throw new Error('No steps defined for case.');
        }
        const session = await agent.startLoopAgentSession(PERFORMANCE_TOOLS, steps[0].prompt, {
            systemPrompt: testCase.systemPrompt,
            initialExpected: steps[0].expected,
        });

        onProgress(`Loop: ${steps[0].id || 'step1'}`);
        // Evaluate initial prompt
        // eslint-disable-next-line no-await-in-loop
        stepResults.push(await evaluateLoopStep(session, steps[0]));
        for (let i = 1; i < steps.length; i += 1) {
            onProgress(`Loop: ${steps[i].id || `step${i + 1}`}`);
            // eslint-disable-next-line no-await-in-loop
            await session.newPrompt(steps[i].prompt, {
                expected: steps[i].expected,
            });
            // eslint-disable-next-line no-await-in-loop
            stepResults.push(await evaluateLoopStep(session, steps[i]));
        }

        if (session.finalizeFailures) {
            await session.finalizeFailures();
        }

        const ok = stepResults.every((step) => step.ok);
        return {
            ok,
            durationMs: Date.now() - started,
            inputChars: agent.getInputCounter(),
            outputChars: agent.getOutputCounter(),
            steps: stepResults,
            error: null,
        };
    } catch (error) {
        return {
            ok: false,
            durationMs: Date.now() - started,
            inputChars: agent.getInputCounter(),
            outputChars: agent.getOutputCounter(),
            steps: stepResults,
            error: error?.message || String(error),
        };
    }
}

async function runWorker() {
    const caseFile = process.env.AGENTIC_CASE;
    const runIndex = Number.parseInt(process.env.AGENTIC_RUN, 10) || 0;

    try {
        if (!caseFile) {
            throw new Error('Missing case file path for worker.');
        }
        const testCase = await loadPerformanceCaseFromFile(caseFile);
        const sendProgress = (message) => {
            if (typeof process.send === 'function') {
                process.send({ type: 'progress', message });
            }
        };

        const sopResult = await runSOPCase(testCase, runIndex, sendProgress);
        const loopResult = await runLoopCase(testCase, runIndex, sendProgress);

        const payload = {
            caseId: testCase.id,
            runIndex,
            sop: sopResult,
            loop: loopResult,
        };

        if (typeof process.send === 'function') {
            process.send({ type: 'result', payload });
        } else {
            // eslint-disable-next-line no-console
            console.log(JSON.stringify(payload, null, 2));
        }
        process.exit(0);
    } catch (error) {
        // eslint-disable-next-line no-console
        console.error('[AgenticPerformance worker] Fatal error:', error);
        process.exit(1);
    }
}

function runCaseInChild(testCase, runIndex, onOutput = null) {
    return new Promise((resolve, reject) => {
        const child = fork(__filename, [], {
            env: {
                ...process.env,
                AGENTIC_PERF_WORKER: '1',
                AGENTIC_CASE: path.join(CASES_DIR, testCase.file),
                AGENTIC_RUN: String(runIndex),
            },
            stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        });

        let resolved = false;
        child.on('message', (message) => {
            if (message?.type === 'progress' && typeof onOutput === 'function') {
                onOutput(message.message);
                return;
            }
            if (message?.type === 'result') {
                resolved = true;
                resolve(message.payload);
            }
        });
        const handleChunk = (chunk) => {
            if (typeof onOutput !== 'function') {
                return;
            }
            const text = chunk.toString('utf8');
            const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
            if (!lines.length) {
                return;
            }
            const lastLine = lines[lines.length - 1];
            onOutput(lastLine);
        };
        child.stdout?.on('data', handleChunk);
        child.stderr?.on('data', handleChunk);
        child.on('error', (error) => {
            if (!resolved) {
                reject(error);
            }
        });
        child.on('exit', (code) => {
            if (!resolved) {
                reject(new Error(`Worker exited with code ${code}`));
            }
        });
    });
}

function printRunResult(label, result) {
    const color = result.ok ? COLORS.GREEN : COLORS.RED;
    const inputTokens = charsToTokens(result.inputChars);
    const outputTokens = charsToTokens(result.outputChars);
    const status = result.ok ? 'PASS' : 'FAIL';
    const errorText = result.error ? ` | error: ${result.error}` : '';
    // eslint-disable-next-line no-console
    console.log(`${color}[${label}] ${status} in ${result.durationMs}ms | sent=${inputTokens} tok, recv=${outputTokens} tok${errorText}${COLORS.RESET}`);
}

function printHeader(testCase, runIndex, runsPerCase) {
    const label = `[Test] ${testCase.id} (${runIndex + 1}/${runsPerCase})`;
    // eslint-disable-next-line no-console
    console.log(`${COLORS.YELLOW}${label}: ${testCase.description}${COLORS.RESET}`);
}

function printSummary(totals) {
    // eslint-disable-next-line no-console
    console.log('\n==== Summary ====');
    ['sop', 'loop'].forEach((key) => {
        const stats = totals[key];
        const label = SESSION_LABELS[key];
        const totalSeconds = (stats.durationMs / 1000).toFixed(2);
        const failures = stats.failures;
        const runs = stats.runs;
        const inputHuman = formatBytesFromChars(stats.inputChars);
        const outputHuman = formatBytesFromChars(stats.outputChars);
        // eslint-disable-next-line no-console
        console.log(`${label}: runs=${runs}, failures=${failures}, duration=${totalSeconds}s, input=${inputHuman}, output=${outputHuman}`);
    });
}

async function main() {
    if (process.env.AGENTIC_PERF_WORKER === '1') {
        await runWorker();
        return;
    }

    const { times, caseNum } = parseArgs();
    // eslint-disable-next-line no-console
    console.log('Hint: run with --help to see available options.');
    // eslint-disable-next-line no-console
    console.log(`[AgenticPerformance] Runs per case: ${times}${caseNum ? ` | Case: ${caseNum}` : ''}`);

    let cases = await loadPerformanceCases();
    if (caseNum) {
        cases = cases.filter((c) => {
            const match = c.id.match(/case_(\d+)/);
            return match && Number.parseInt(match[1], 10) === caseNum;
        });
    }

    if (!cases.length) {
        // eslint-disable-next-line no-console
        console.log('No performance cases found.');
        return;
    }

    const totals = {
        sop: { runs: 0, failures: 0, durationMs: 0, inputChars: 0, outputChars: 0 },
        loop: { runs: 0, failures: 0, durationMs: 0, inputChars: 0, outputChars: 0 },
    };

    for (const testCase of cases) {
        for (let runIndex = 0; runIndex < times; runIndex += 1) {
            const runningLabel = `[Running] ${testCase.id} (${runIndex + 1}/${times})`;
            const progress = startProgress(runningLabel);
            printHeader(testCase, runIndex, times);
            // eslint-disable-next-line no-await-in-loop
            const result = await runCaseInChild(testCase, runIndex, progress.setMessage);
            progress.stop();
            printRunResult(SESSION_LABELS.sop, result.sop);
            printRunResult(SESSION_LABELS.loop, result.loop);

            totals.sop.runs += 1;
            totals.sop.durationMs += result.sop.durationMs;
            totals.sop.inputChars += result.sop.inputChars;
            totals.sop.outputChars += result.sop.outputChars;
            if (!result.sop.ok) {
                totals.sop.failures += 1;
            }

            totals.loop.runs += 1;
            totals.loop.durationMs += result.loop.durationMs;
            totals.loop.inputChars += result.loop.inputChars;
            totals.loop.outputChars += result.loop.outputChars;
            if (!result.loop.ok) {
                totals.loop.failures += 1;
            }
        }
    }

    printSummary(totals);
}

main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[AgenticPerformance] Fatal error:', err);
    process.exit(1);
});
