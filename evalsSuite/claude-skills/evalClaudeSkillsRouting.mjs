/**
 * Claude Skills routing benchmark.
 * Tests the full two-level agentic stack:
 *   Outer session (loop/sop/json/md) routes to Claude skills → ClaudeSkillsSubsystem → inner LoopAgentSession with file tools
 *
 * Unlike runClaudeSkills.mjs (which passes explicit skillName), this benchmark
 * omits skillName so the top-level session must decide which skill to invoke.
 *
 * Usage:
 *   node evalsSuite/claude-skills/evalClaudeSkillsRouting.mjs [options]
 *
 * Options:
 *   --session <loop|sop|json|md|both|all>  Session type (default: both = loop,sop)
 *   --mode, -m <tier>          LLM tier for planner (default: plan)
 *   --tool-mode <tier>         LLM tier for tool execution (overrides fast)
 *   --prompt <default|gp>      System prompt: default or general-purpose
 *   --times, -t <N>            Run each case N times (default: 1)
 *   --case, -c <N>             Run only case number N
 *   --debug, -d                Show debug output
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { RecursiveSkilledAgent } = await import('../../RecursiveSkilledAgents/RecursiveSkilledAgent.mjs');
const { LLMAgent } = await import('../../LLMAgents/LLMAgent.mjs');

const SKILLS_ROOT = path.join(__dirname, '..', 'anthropic-skills', 'skills');

const COLORS = {
    RESET: '\x1b[0m',
    RED: '\x1b[31m',
    LIGHT_RED: '\x1b[91m',
    GREEN: '\x1b[32m',
    YELLOW: '\x1b[33m',
    CYAN: '\x1b[36m',
};

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
    const started = Date.now();
    const timer = setInterval(() => {
        const elapsed = Date.now() - started;
        const frame = frames[idx % frames.length];
        idx += 1;
        writeProgress(`${frame} ${label} ... ${elapsed}ms`);
    }, 150);
    return {
        stop: () => { clearInterval(timer); clearProgressLine(); },
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function ensureDir(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
}

function writeFile(filePath, content) {
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, content, 'utf8');
}

function coerceResultToText(result) {
    if (result == null) return '';
    if (typeof result === 'string') return result;
    if (typeof result === 'object') {
        if (typeof result.text === 'string') return result.text;
        if (typeof result.output === 'string') return result.output;
        if (typeof result.result === 'string') return result.result;
        try { return JSON.stringify(result); } catch { return String(result); }
    }
    return String(result);
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
// Test cases
// ─────────────────────────────────────────────────────────────────────────────

function buildTestCases(workspace) {
    const csvInput = path.join(workspace, 'input.csv');
    writeFile(csvInput, 'Item,Amount\nAlpha,10\nBeta,5\n');

    return [
        {
            id: 'pdf-check',
            description: 'Route to pdf-lite for compliance checking',
            prompt: 'Here is the PDF text:\nTitle: Q1 Review\nOverview: This quarter focused on onboarding.\nFindings: Customer satisfaction improved.\nConclusion: Continue the program.\n\nPlease check it against your checklist and output PASS/FAIL per item with a one-line summary.',
            validate: (text) => {
                const lower = text.toLowerCase();
                // Must contain PASS verdicts — at least 3 PASS mentions and mention of conclusion
                const passCount = (lower.match(/pass/g) || []).length;
                return passCount >= 3 && (lower.includes('conclusion') || lower.includes('overall'));
            },
            expectedContains: ['PASS'],
        },
        {
            id: 'docx-memo',
            description: 'Route to docx-lite for document drafting',
            prompt: 'Draft a short memo titled "Project Update". Summary: This release closes the onboarding gaps. Customer satisfaction improved after the fixes. Action items: Share the rollout note with stakeholders; Schedule a follow-up review; Monitor adoption metrics. Return the memo text only.',
            validate: (text) => {
                const lower = text.toLowerCase();
                return lower.includes('project update') && lower.includes('action');
            },
            expectedContains: ['Project Update'],
        },
        {
            id: 'pptx-outline',
            description: 'Route to pptx-lite for slide outline generation',
            prompt: 'Create a 3-slide outline about "Remote Work Guidelines". Slide 1 should be the title slide, slide 2 a policy overview, and slide 3 next steps. Use the required slide format exactly.',
            validate: (text) => {
                const lower = text.toLowerCase();
                return lower.includes('slide 1') && lower.includes('slide 2') && lower.includes('slide 3')
                    && lower.includes('remote work');
            },
            expectedContains: ['Slide 1', 'Slide 2', 'Slide 3'],
        },
        {
            id: 'xlsx-csv',
            description: 'Route to xlsx-lite for CSV processing with script',
            prompt: `I have a CSV at ${csvInput}. Please add a Totals row for the Amount column and save the updated file to ${path.join(workspace, 'output.csv')}. Reply with just the total value.`,
            validate: (text) => {
                return text.includes('15');
            },
            validateFile: () => {
                const outPath = path.join(workspace, 'output.csv');
                if (!fs.existsSync(outPath)) return false;
                const content = fs.readFileSync(outPath, 'utf8');
                return content.includes('Totals') && content.includes('15');
            },
            expectedContains: ['15'],
        },
    ];
}

// ─────────────────────────────────────────────────────────────────────────────
// Run a case via RecursiveSkilledAgent (no skillName → full routing)
// ─────────────────────────────────────────────────────────────────────────────

async function runCase(sessionType, testCase, runIndex, options = {}) {
    const { debug = false, mode = 'plan', toolMode = null, systemPromptOverride = null } = options;
    const started = Date.now();

    const agent = new LLMAgent({ name: `RSA-Claude-${sessionType}-${testCase.id}-run${runIndex + 1}` });

    // When toolMode is set, remap 'fast' → toolMode in agent.complete()
    if (toolMode) {
        const originalComplete = agent.complete.bind(agent);
        agent.complete = function (opts = {}) {
            if (opts.mode === 'fast') {
                return originalComplete({ ...opts, mode: toolMode });
            }
            return originalComplete(opts);
        };
    }

    const rsa = new RecursiveSkilledAgent({
        llmAgent: agent,
        startDir: __dirname,
        searchUpwards: false,
        additionalSkillRoots: [SKILLS_ROOT],
        sessionType,
        systemPrompt: systemPromptOverride || undefined,
        maxStepsPerTurn: 15,
    });

    try {
        // Log discovered skills in debug mode
        if (debug) {
            const allSkills = rsa.registry.getAll();
            console.log(`${COLORS.CYAN}[${sessionType}] Discovered ${allSkills.length} skills: ${allSkills.map(s => s.shortName || s.name).join(', ')}${COLORS.RESET}`);
        }

        // Add nonce to bypass prompt cache
        const nonce = `\n<!-- [bench-${Date.now()}-${Math.random().toString(36).slice(2, 8)}] -->`;

        // Execute WITHOUT skillName → forces routing through top-level session
        const result = await rsa.executePrompt(testCase.prompt + nonce, {
            context: { sessionId: `bench-${testCase.id}-${runIndex}` },
            mode,
        });

        const text = coerceResultToText(result?.result ?? result);

        // Validate
        let ok = true;
        const failures = [];

        if (testCase.validate && !testCase.validate(text)) {
            ok = false;
            failures.push('content validation failed');
        }

        if (testCase.validateFile && !testCase.validateFile()) {
            ok = false;
            failures.push('file validation failed');
        }

        for (const fragment of testCase.expectedContains || []) {
            if (!text.toLowerCase().includes(fragment.toLowerCase())) {
                ok = false;
                failures.push(`missing "${fragment}"`);
            }
        }

        if (debug && !ok) {
            console.log(`${COLORS.LIGHT_RED}[${sessionType}][${testCase.id}] Failures: ${failures.join(', ')}${COLORS.RESET}`);
            console.log(`${COLORS.LIGHT_RED}[${sessionType}][${testCase.id}] Result (first 500 chars): ${text.slice(0, 500)}${COLORS.RESET}`);
        }

        rsa.shutdown();

        return {
            ok,
            durationMs: Date.now() - started,
            inputChars: agent.getInputCounter(),
            outputChars: agent.getOutputCounter(),
            failures,
            subsystem: result?.subsystem || 'unknown',
            error: null,
        };
    } catch (error) {
        if (debug) {
            console.log(`${COLORS.LIGHT_RED}[${sessionType}][${testCase.id}] Error: ${error?.message || String(error)}${COLORS.RESET}`);
        }
        rsa.shutdown();
        return {
            ok: false,
            durationMs: Date.now() - started,
            inputChars: agent.getInputCounter(),
            outputChars: agent.getOutputCounter(),
            failures: [error?.message || String(error)],
            subsystem: 'error',
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
            'Usage: node evalsSuite/claude-skills/evalClaudeSkillsRouting.mjs [options]',
            '',
            'Tests the full two-level stack: outer routing session → Claude skills → inner LoopAgentSession',
            '',
            'Options:',
            '  --session <loop|sop|json|md|both|all>  Session type to benchmark (default: both)',
            '  --mode, -m <tier>          LLM tier for planner: fast, plan, deep, ultra (default: plan)',
            '  --tool-mode <tier>         LLM tier for tool execution (overrides fast)',
            '  --prompt <default|gp>      System prompt: default or gp (general-purpose)',
            '  --times, -t <N>            Run each case N times (default: 1)',
            '  --case, -c <N>             Run only case number N (1-4)',
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

function printRunResult(sessionType, testCase, result) {
    const color = result.ok ? COLORS.GREEN : COLORS.RED;
    const inputTokens = charsToTokens(result.inputChars);
    const outputTokens = charsToTokens(result.outputChars);
    const status = result.ok ? 'PASS' : 'FAIL';
    const errorText = result.error ? ` | error: ${result.error.slice(0, 100)}` : '';
    const failText = !result.ok && result.failures.length ? ` | ${result.failures.join('; ')}` : '';
    console.log(`${color}[${sessionType}] ${status} in ${result.durationMs}ms | sent=${inputTokens} tok, recv=${outputTokens} tok | via=${result.subsystem}${failText}${errorText}${COLORS.RESET}`);
}

function printSummary(totals) {
    console.log('\n==== Claude Skills Routing Benchmark Summary ====');
    for (const [key, stats] of Object.entries(totals)) {
        const totalSeconds = (stats.durationMs / 1000).toFixed(2);
        const inputHuman = formatBytesFromChars(stats.inputChars);
        const outputHuman = formatBytesFromChars(stats.outputChars);
        const passRate = stats.runs > 0 ? `${Math.round((1 - stats.failures / stats.runs) * 100)}%` : 'N/A';
        console.log(`${key}: runs=${stats.runs}, pass=${passRate}, failures=${stats.failures}, duration=${totalSeconds}s, input=${inputHuman}, output=${outputHuman}`);
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
    console.log(`[Claude Skills Routing Benchmark] Session types: ${sessionTypes.join(', ')} | Mode: ${mode}${toolModeLabel}${promptLabel} | Runs per case: ${times}${debug ? ' (debug)' : ''}${caseNum ? ` | Case: ${caseNum}` : ''}`);

    // Create temp workspace for file-based tests
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-skills-bench-'));
    const workspace = path.join(tempRoot, 'workspace');
    ensureDir(workspace);

    try {
        let cases = buildTestCases(workspace);
        if (caseNum) {
            cases = cases.filter((_, i) => i + 1 === caseNum);
        }

        if (!cases.length) {
            console.log('No test cases to run.');
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
                    // Recreate workspace files for each run (xlsx test modifies them)
                    if (testCase.id === 'xlsx-csv') {
                        writeFile(path.join(workspace, 'input.csv'), 'Item,Amount\nAlpha,10\nBeta,5\n');
                        // Remove output.csv if it exists from previous run
                        const outPath = path.join(workspace, 'output.csv');
                        if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
                    }

                    const progress = debug
                        ? { stop: () => {} }
                        : startProgress(`${st}: ${testCase.id}`);

                    const result = await runCase(st, testCase, runIndex, {
                        debug,
                        mode,
                        toolMode,
                        systemPromptOverride,
                    });
                    progress.stop();
                    printRunResult(st, testCase, result);

                    totals[st].runs += 1;
                    totals[st].durationMs += result.durationMs;
                    totals[st].inputChars += result.inputChars;
                    totals[st].outputChars += result.outputChars;
                    if (!result.ok) totals[st].failures += 1;
                }
            }
        }

        printSummary(totals);
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
}

main().catch((err) => {
    console.error('[Claude Skills Routing Benchmark] Fatal error:', err);
    process.exit(1);
});
