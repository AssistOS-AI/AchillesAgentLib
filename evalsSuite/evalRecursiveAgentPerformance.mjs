/**
 * RSA-level benchmark runner.
 * Tests RecursiveSkilledAgent's top-level agentic session (via AgenticSessionAdapter)
 * with all PERFORMANCE_TOOLS registered as skills.
 *
 * Usage:
 *   node evalsSuite/evalRecursiveAgentPerformance.mjs [--session loop|sop|both] [--times N] [--case N] [--debug]
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CASES_DIR = path.join(__dirname, 'performanceCases');

import { PERFORMANCE_TOOLS } from './tools/allTools.mjs';

const { LLMAgent } = await import('../LLMAgents/LLMAgent.mjs');
const { createSessionAdapter } = await import('../LLMAgents/AgenticSessionAdapter.mjs');

const COLORS = {
    RESET: '\x1b[0m',
    RED: '\x1b[31m',
    LIGHT_RED: '\x1b[91m',
    GREEN: '\x1b[32m',
    YELLOW: '\x1b[33m',
    CYAN: '\x1b[36m',
};

// ─────────────────────────────────────────────────────────────────────────────
// Progress display
// ─────────────────────────────────────────────────────────────────────────────

let lastStatusLength = 0;
function writeProgress(text) {
    const safe = text || '';
    if (process.stdout.isTTY) {
        readline.cursorTo(process.stdout, 0);
        readline.clearLine(process.stdout, 0);
        process.stdout.write(safe);
    } else {
        process.stdout.write(`\r${safe}`);
    }
    lastStatusLength = safe.length;
}

function clearProgressLine() {
    if (!lastStatusLength) return;
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
        stop: () => { clearInterval(timer); clearProgressLine(); },
        setMessage: (msg) => {
            if (typeof msg !== 'string') return;
            lastMessage = msg.trim().replace(/\s+/g, ' ').slice(0, 120);
        },
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Case loading
// ─────────────────────────────────────────────────────────────────────────────

async function loadCaseFromFile(filePath) {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    const steps = Array.isArray(parsed.steps) ? parsed.steps : [];
    const normalizedSteps = steps.length
        ? steps
        : [{ prompt: parsed.prompt || '', expected: parsed.expected ?? '' }];

    return {
        file: path.basename(filePath),
        id: parsed.id || path.basename(filePath).replace(/\.json$/, ''),
        description: parsed.systemPrompt || parsed.description || '',
        systemPrompt: parsed.systemPrompt || '',
        steps: normalizedSteps.map((step, index) => ({
            prompt: step.prompt || '',
            expected: step.expected ?? '',
            id: step.id || `step_${index + 1}`,
        })),
    };
}

async function loadAllCases() {
    const files = await fs.readdir(CASES_DIR);
    const cases = [];
    for (const file of files.filter((f) => f.endsWith('.json')).sort()) {
        cases.push(await loadCaseFromFile(path.join(CASES_DIR, file)));
    }
    return cases;
}

// ─────────────────────────────────────────────────────────────────────────────
// Unified skills from PERFORMANCE_TOOLS
// ─────────────────────────────────────────────────────────────────────────────

function buildSkillsList() {
    return Object.entries(PERFORMANCE_TOOLS).map(([name, spec]) => ({
        name,
        description: spec.description,
        handler: spec.handler,
    }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function normalizeValue(value) {
    return String(value ?? '').trim().toLowerCase();
}

function charsToTokens(chars) {
    return Math.ceil((chars || 0) / 4);
}

function formatBytesFromChars(chars) {
    const bytes = chars || 0;
    if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(2)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    return `${bytes} B`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Run a case via the adapter
// ─────────────────────────────────────────────────────────────────────────────

const GP_SYSTEM_PROMPT = `You are a skilled assistant with access to specialized tools.
Each tool is a self-contained skill that handles a specific domain.
Route user requests to the most relevant tool based on its description.

Guidelines:
- Match the user's intent to the tool whose description best fits.
- Pass the user's full request as the tool prompt — the skill handles the details.
- For multi-step tasks, chain tools: use one tool's output as input to the next.
- If no tool matches, use final_answer to respond directly.
- When a tool returns a result, pass it to final_answer — do not rephrase or summarize.
- Prefer a single well-matched tool over combining multiple loosely-matched ones.`;

async function runCaseWithAdapter(sessionType, testCase, runIndex, debug = false, mode = 'plan', toolMode = null, systemPromptOverride = null) {
    const started = Date.now();
    const agentName = `RSA-${sessionType}-${testCase.id}-run${runIndex + 1}`;
    const agent = new LLMAgent({ name: agentName });

    // When toolMode is set, wrap agent.complete() to remap 'fast' → toolMode
    // This lets tool handlers (which hardcode mode:'fast') use a different tier
    if (toolMode) {
        const originalComplete = agent.complete.bind(agent);
        agent.complete = function (options = {}) {
            if (options.mode === 'fast') {
                return originalComplete({ ...options, mode: toolMode });
            }
            return originalComplete(options);
        };
    }

    const stepResults = [];

    try {
        const steps = testCase.steps || [];
        if (!steps.length) throw new Error('No steps defined for case.');

        const skills = buildSkillsList();
        const adapter = createSessionAdapter(sessionType, {
            agent,
            skills,
            options: {
                systemPrompt: systemPromptOverride || testCase.systemPrompt || 'Use the available tools to complete the task.',
                maxStepsPerTurn: 15,
                mode,
            },
        });

        // Add nonce to bypass Soul Gateway prompt cache
        const nonce = `\n<!-- [bench-${Date.now()}-${Math.random().toString(36).slice(2, 8)}] -->`;

        // First step
        const firstResult = await adapter.newPrompt(steps[0].prompt + nonce);
        const firstAnswer = adapter.getLastResult();
        const firstNormExpected = normalizeValue(steps[0].expected);
        const firstNormAnswer = normalizeValue(firstAnswer);
        const firstOk = firstNormExpected ? firstNormExpected === firstNormAnswer : false;
        stepResults.push({
            ok: firstOk,
            expected: steps[0].expected,
            answer: firstAnswer ?? '',
        });
        if (debug && !firstOk) {
            console.log(`${COLORS.LIGHT_RED}[${sessionType}][${testCase.id}][${steps[0].id}] FAIL expected="${steps[0].expected}" got="${firstAnswer}"${COLORS.RESET}`);
        }

        // Remaining steps
        for (let i = 1; i < steps.length; i += 1) {
            const stepNonce = `\n<!-- [bench-${Date.now()}-${Math.random().toString(36).slice(2, 8)}] -->`;
            await adapter.newPrompt(steps[i].prompt + stepNonce);
            const answer = adapter.getLastResult();
            const normExpected = normalizeValue(steps[i].expected);
            const normAnswer = normalizeValue(answer);
            const ok = normExpected ? normExpected === normAnswer : false;
            stepResults.push({
                ok,
                expected: steps[i].expected,
                answer: answer ?? '',
            });
            if (debug && !ok) {
                console.log(`${COLORS.LIGHT_RED}[${sessionType}][${testCase.id}][${steps[i].id}] FAIL expected="${steps[i].expected}" got="${answer}"${COLORS.RESET}`);
            }
        }

        const ok = stepResults.every((s) => s.ok);
        return {
            ok,
            durationMs: Date.now() - started,
            inputChars: agent.getInputCounter(),
            outputChars: agent.getOutputCounter(),
            steps: stepResults,
            error: null,
        };
    } catch (error) {
        if (debug) {
            console.log(`${COLORS.LIGHT_RED}[${sessionType}][${testCase.id}] Error: ${error?.message || String(error)}${COLORS.RESET}`);
        }
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

// ─────────────────────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────────────────────

function parseArgs() {
    const args = process.argv.slice(2);
    let times = 1;
    let debug = false;
    let caseNum = null;
    let session = 'both';
    let mode = 'plan';
    let toolMode = null;
    let promptType = 'default';

    if (args.includes('--help') || args.includes('-h')) {
        console.log([
            'Usage: node evalsSuite/evalRecursiveAgentPerformance.mjs [options]',
            '',
            'Options:',
            '  --session <loop|sop|json|md|both|all>  Session type to benchmark (default: both)',
            '  --mode, -m <tier>          LLM tier for planner: fast, plan, deep, ultra (default: plan)',
            '  --tool-mode <tier>         LLM tier for tool execution (overrides fast). Omit to keep fast.',
            '  --prompt <default|gp>      System prompt: default (case-specific) or gp (general-purpose)',
            '  --times, -t <N>            Run each case N times (default: 1)',
            '  --case, -c <N>             Run only case number N (e.g. 1 for case_01)',
            '  --debug, -d                Show debug output',
            '  --help, -h                 Show this help message',
        ].join('\n'));
        process.exit(0);
    }

    for (let i = 0; i < args.length; i += 1) {
        const arg = args[i];
        if (arg === '--debug' || arg === '-d') {
            debug = true;
        } else if (arg === '--times' || arg === '-t') {
            const parsed = Number.parseInt(args[i + 1], 10);
            if (Number.isFinite(parsed) && parsed > 0) { times = parsed; i += 1; }
        } else if (arg === '--case' || arg === '-c') {
            const parsed = Number.parseInt(args[i + 1], 10);
            if (Number.isFinite(parsed) && parsed > 0) { caseNum = parsed; i += 1; }
        } else if (arg === '--session' || arg === '-s') {
            const val = (args[i + 1] || '').toLowerCase();
            if (['loop', 'sop', 'json', 'md', 'both', 'all'].includes(val)) { session = val; i += 1; }
        } else if (arg === '--mode' || arg === '-m') {
            const val = (args[i + 1] || '').toLowerCase();
            if (['fast', 'plan', 'write', 'code', 'deep', 'ultra'].includes(val)) { mode = val; i += 1; }
        } else if (arg === '--tool-mode') {
            const val = (args[i + 1] || '').toLowerCase();
            if (['fast', 'plan', 'write', 'code', 'deep', 'ultra'].includes(val)) { toolMode = val; i += 1; }
        } else if (arg === '--prompt' || arg === '-p') {
            const val = (args[i + 1] || '').toLowerCase();
            if (['default', 'gp'].includes(val)) { promptType = val; i += 1; }
        }
    }

    return { times, debug, caseNum, session, mode, toolMode, promptType };
}

function printRunResult(sessionType, result) {
    const color = result.ok ? COLORS.GREEN : COLORS.RED;
    const inputTokens = charsToTokens(result.inputChars);
    const outputTokens = charsToTokens(result.outputChars);
    const status = result.ok ? 'PASS' : 'FAIL';
    const errorText = result.error ? ` | error: ${result.error}` : '';
    console.log(`${color}[${sessionType}] ${status} in ${result.durationMs}ms | sent=${inputTokens} tok, recv=${outputTokens} tok${errorText}${COLORS.RESET}`);
}

function printSummary(totals) {
    console.log('\n==== RSA Benchmark Summary ====');
    for (const [key, stats] of Object.entries(totals)) {
        const totalSeconds = (stats.durationMs / 1000).toFixed(2);
        const inputHuman = formatBytesFromChars(stats.inputChars);
        const outputHuman = formatBytesFromChars(stats.outputChars);
        console.log(`${key}: runs=${stats.runs}, failures=${stats.failures}, duration=${totalSeconds}s, input=${inputHuman}, output=${outputHuman}`);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
    const { times, debug, caseNum, session, mode, toolMode, promptType } = parseArgs();
    const sessionTypes = session === 'both' ? ['loop', 'sop']
        : session === 'all' ? ['loop', 'sop', 'json', 'md']
        : [session];

    const systemPromptOverride = promptType === 'gp' ? GP_SYSTEM_PROMPT : null;
    const toolModeLabel = toolMode ? ` | Tool mode: ${toolMode}` : '';
    const promptLabel = promptType !== 'default' ? ` | Prompt: ${promptType}` : '';
    console.log(`[RSA Benchmark] Session types: ${sessionTypes.join(', ')} | Mode: ${mode}${toolModeLabel}${promptLabel} | Runs per case: ${times}${debug ? ' (debug)' : ''}${caseNum ? ` | Case: ${caseNum}` : ''}`);

    let cases = await loadAllCases();
    if (caseNum) {
        cases = cases.filter((c) => {
            const match = c.id.match(/case_(\d+)/);
            return match && Number.parseInt(match[1], 10) === caseNum;
        });
    }

    if (!cases.length) {
        console.log('No performance cases found.');
        return;
    }

    const totals = {};
    for (const st of sessionTypes) {
        totals[st] = { runs: 0, failures: 0, durationMs: 0, inputChars: 0, outputChars: 0 };
    }

    for (const testCase of cases) {
        for (let runIndex = 0; runIndex < times; runIndex += 1) {
            console.log(`${COLORS.YELLOW}[Test] ${testCase.id} (${runIndex + 1}/${times}): ${testCase.description}${COLORS.RESET}`);

            for (const st of sessionTypes) {
                const progress = debug
                    ? { stop: () => {}, setMessage: () => {} }
                    : startProgress(`${st}: ${testCase.id}`);

                const result = await runCaseWithAdapter(st, testCase, runIndex, debug, mode, toolMode, systemPromptOverride);
                progress.stop();
                printRunResult(st, result);

                totals[st].runs += 1;
                totals[st].durationMs += result.durationMs;
                totals[st].inputChars += result.inputChars;
                totals[st].outputChars += result.outputChars;
                if (!result.ok) totals[st].failures += 1;
            }
        }
    }

    printSummary(totals);
}

main().catch((err) => {
    console.error('[RSA Benchmark] Fatal error:', err);
    process.exit(1);
});
