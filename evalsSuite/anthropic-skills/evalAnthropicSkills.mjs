/**
 * Anthropic Skills benchmark.
 * Tests the full two-level agentic stack with all 8 SKILL.md skills:
 *   Outer session (loop/sop/json/md) routes to skill → AnthropicSkillsSubsystem → inner LoopAgentSession with file tools
 *
 * Skills tested:
 *   get-resource: pdf-lite, docx-lite, json-lint
 *   run-script:   xlsx-lite, text-stats, csv-filter
 *   no tools:     pptx-lite, meeting-notes
 *
 * Usage:
 *   node evalsSuite/anthropic-skills/evalAnthropicSkills.mjs [options]
 *
 * Options:
 *   --session <loop|sop|json|md|both|all>  Session type (default: loop)
 *   --mode, -m <tier>          LLM tier for planner (default: plan)
 *   --tool-mode <tier>         LLM tier for tool execution (overrides fast)
 *   --times, -t <N>            Run each case N times (default: 1)
 *   --case, -c <N>             Run only case number N
 *   --skill <name>             Run only cases for this skill
 *   --direct                   Bypass routing — pass explicit skillName
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

const SKILLS_ROOT = path.join(__dirname, 'skills');

const COLORS = {
    RESET: '\x1b[0m',
    RED: '\x1b[31m',
    LIGHT_RED: '\x1b[91m',
    GREEN: '\x1b[32m',
    YELLOW: '\x1b[33m',
    CYAN: '\x1b[36m',
    DIM: '\x1b[2m',
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
// Test cases — 2 per skill, 16 total
// ─────────────────────────────────────────────────────────────────────────────

function buildTestCases(workspace) {
    // Prepare input files for file-based tests
    const csvInput = path.join(workspace, 'sales.csv');
    writeFile(csvInput, 'Product,Revenue\nWidget,200\nGadget,150\nDoohickey,50\n');

    const filterInput = path.join(workspace, 'scores.csv');
    writeFile(filterInput, 'Student,Score\nAlice,85\nBob,42\nCarol,91\nDave,67\nEve,73\n');

    const textInput = path.join(workspace, 'sample.txt');
    writeFile(textInput, 'The quick brown fox jumps over the lazy dog. Pack my box with five dozen liquor jugs. How vexingly quick daft zebras jump.');

    const textInput2 = path.join(workspace, 'article.txt');
    writeFile(textInput2, 'Artificial intelligence is transforming industries worldwide. Companies are investing billions in AI research and development. The impact on productivity has been significant. However, ethical concerns remain a key challenge for the industry.');

    return [
        // ── pdf-lite (get-resource: checklist) ──────────────────────────────
        {
            id: 'pdf-check-pass',
            skill: 'pdf-lite',
            skillName: 'pdf-lite-anthropic',
            description: 'PDF with all required sections → all PASS',
            prompt: 'Here is the PDF text:\nTitle: Annual Report 2025\nOverview: Revenue grew 15% year over year.\nFindings: Customer retention improved across all segments.\nConclusion: Continue current strategy with minor adjustments.\n\nCheck it against your checklist and output PASS/FAIL per item with a summary.',
            validate: (text) => {
                const lower = text.toLowerCase();
                const passCount = (lower.match(/pass/g) || []).length;
                return passCount >= 3 && (lower.includes('conclusion') || lower.includes('overall'));
            },
        },
        {
            id: 'pdf-check-fail',
            skill: 'pdf-lite',
            skillName: 'pdf-lite-anthropic',
            description: 'PDF missing sections → some FAIL',
            prompt: 'Here is the PDF text:\nTitle: Budget Memo\nConclusion: Approved for Q2.\n\nCheck it against your checklist and output PASS/FAIL per item with a summary.',
            validate: (text) => {
                const lower = text.toLowerCase();
                return lower.includes('fail') && lower.includes('pass');
            },
        },

        // ── docx-lite (get-resource: template) ──────────────────────────────
        {
            id: 'docx-memo',
            skill: 'docx-lite',
            skillName: 'docx-lite-anthropic',
            description: 'Draft a memo from template',
            prompt: 'Draft a memo titled "Security Incident Report". Summary: A phishing attempt was detected and blocked by the email gateway on March 10. No user accounts were compromised. Action items: Notify the security team; Update phishing filters; Send awareness reminder to staff. Return the memo text only.',
            validate: (text) => {
                const lower = text.toLowerCase();
                return lower.includes('security incident report') && lower.includes('action') && !lower.includes('{{');
            },
        },
        {
            id: 'docx-project-plan',
            skill: 'docx-lite',
            skillName: 'docx-lite-anthropic',
            description: 'Draft a project plan from template',
            prompt: 'Draft a memo titled "Migration Plan". Summary: We are migrating the legacy database to PostgreSQL 16 over the next two sprints. Action items: Back up existing data; Run migration scripts; Validate data integrity. Return the memo text only.',
            validate: (text) => {
                const lower = text.toLowerCase();
                return lower.includes('migration plan') && lower.includes('action') && !lower.includes('{{');
            },
        },

        // ── pptx-lite (no tools) ────────────────────────────────────────────
        {
            id: 'pptx-3slides',
            skill: 'pptx-lite',
            skillName: 'pptx-lite-anthropic',
            description: '3-slide outline on a business topic',
            prompt: 'Create a 3-slide outline about "Quarterly Business Review". Slide 1 is the title slide, slide 2 covers financial highlights, slide 3 covers next quarter goals. Use the required slide format exactly.',
            validate: (text) => {
                const lower = text.toLowerCase();
                return lower.includes('slide 1') && lower.includes('slide 2') && lower.includes('slide 3');
            },
        },
        {
            id: 'pptx-5slides',
            skill: 'pptx-lite',
            skillName: 'pptx-lite-anthropic',
            description: '5-slide outline on a technical topic',
            prompt: 'Create a 5-slide outline about "API Security Best Practices". Slide 1 title, slide 2 authentication, slide 3 input validation, slide 4 rate limiting, slide 5 summary. Use the required slide format exactly.',
            validate: (text) => {
                const lower = text.toLowerCase();
                return lower.includes('slide 1') && lower.includes('slide 3') && lower.includes('slide 5')
                    && (lower.includes('security') || lower.includes('api'));
            },
        },

        // ── xlsx-lite (run-script: sum_column.py) ───────────────────────────
        {
            id: 'xlsx-sum',
            skill: 'xlsx-lite',
            skillName: 'xlsx-lite-anthropic',
            description: 'Sum a revenue column in CSV',
            prompt: `I have a CSV at ${csvInput}. Add a Totals row for the Revenue column and save to ${path.join(workspace, 'sales_out.csv')}. Reply with just the total value.`,
            validate: (text) => text.includes('400'),
            validateFile: () => {
                const outPath = path.join(workspace, 'sales_out.csv');
                if (!fs.existsSync(outPath)) return false;
                const content = fs.readFileSync(outPath, 'utf8');
                return content.includes('Totals') && content.includes('400');
            },
        },
        {
            id: 'xlsx-sum-2',
            skill: 'xlsx-lite',
            skillName: 'xlsx-lite-anthropic',
            description: 'Sum a score column in CSV',
            prompt: `I have a CSV at ${filterInput}. Add a Totals row for the Score column and save to ${path.join(workspace, 'scores_totals.csv')}. Reply with just the total value.`,
            validate: (text) => text.includes('358'),
            validateFile: () => {
                const outPath = path.join(workspace, 'scores_totals.csv');
                if (!fs.existsSync(outPath)) return false;
                const content = fs.readFileSync(outPath, 'utf8');
                return content.includes('Totals') && content.includes('358');
            },
        },

        // ── json-lint (get-resource: rules) ─────────────────────────────────
        {
            id: 'json-valid',
            skill: 'json-lint',
            skillName: 'json-lint-anthropic',
            description: 'Valid JSON passes all rules',
            prompt: 'Validate this JSON:\n```json\n{"name": "test-pkg", "version": "2.1.0", "entries": [{"id": 1, "label": "Alpha"}, {"id": 2, "label": "Beta"}]}\n```',
            validate: (text) => {
                const lower = text.toLowerCase();
                const passCount = (lower.match(/valid/g) || []).length;
                return passCount >= 4 && !lower.includes('invalid');
            },
        },
        {
            id: 'json-invalid',
            skill: 'json-lint',
            skillName: 'json-lint-anthropic',
            description: 'JSON with missing fields → some INVALID',
            prompt: 'Validate this JSON:\n```json\n{"name": "demo", "entries": [{"id": 1}, {"id": 2, "label": "Beta"}]}\n```',
            validate: (text) => {
                const lower = text.toLowerCase();
                return lower.includes('invalid') && lower.includes('valid');
            },
        },

        // ── text-stats (run-script: text_stats.py) ──────────────────────────
        {
            id: 'text-stats-short',
            skill: 'text-stats',
            skillName: 'text-stats-anthropic',
            description: 'Compute stats on a short text file',
            prompt: `Compute text statistics for the file at ${textInput}. Return the stats.`,
            validate: (text) => {
                const lower = text.toLowerCase();
                return lower.includes('words') && lower.includes('sentences');
            },
        },
        {
            id: 'text-stats-article',
            skill: 'text-stats',
            skillName: 'text-stats-anthropic',
            description: 'Compute stats on a longer text file',
            prompt: `Compute text statistics for the file at ${textInput2}. Return the stats.`,
            validate: (text) => {
                const lower = text.toLowerCase();
                return lower.includes('words') && lower.includes('sentences');
            },
        },

        // ── meeting-notes (no tools) ────────────────────────────────────────
        {
            id: 'meeting-standup',
            skill: 'meeting-notes',
            skillName: 'meeting-notes-anthropic',
            description: 'Structure a standup summary',
            prompt: 'Here is the meeting transcript:\nAlice said she finished the login page. Bob is blocked on the API integration and needs help from Carol. Carol will review Bob\'s PR today. They decided to push the release to Friday. Dave was absent.\n\nConvert this into structured meeting notes.',
            validate: (text) => {
                const lower = text.toLowerCase();
                return lower.includes('attendees') && lower.includes('action') && lower.includes('decision');
            },
        },
        {
            id: 'meeting-planning',
            skill: 'meeting-notes',
            skillName: 'meeting-notes-anthropic',
            description: 'Structure a planning meeting',
            prompt: 'Meeting notes from sprint planning:\nTeam: Sarah (PM), Mike (backend), Lisa (frontend), Tom (QA). They discussed the new search feature. Mike will build the API endpoint by Wednesday. Lisa will create the search UI component. Tom will write test cases. Sarah decided to cut the advanced filters from this sprint to reduce scope.\n\nConvert this into structured meeting notes.',
            validate: (text) => {
                const lower = text.toLowerCase();
                return lower.includes('attendees') && lower.includes('action') && lower.includes('decision')
                    && (lower.includes('sarah') || lower.includes('mike'));
            },
        },

        // ── csv-filter (run-script: filter_rows.py) ─────────────────────────
        {
            id: 'csv-filter-70',
            skill: 'csv-filter',
            skillName: 'csv-filter-anthropic',
            description: 'Filter CSV rows with Score >= 70',
            prompt: `Filter the CSV at ${filterInput}. Keep only rows where Score is at least 70. Save the result to ${path.join(workspace, 'passing.csv')}. Tell me how many rows were kept.`,
            validate: (text) => text.includes('3'),
            validateFile: () => {
                const outPath = path.join(workspace, 'passing.csv');
                if (!fs.existsSync(outPath)) return false;
                const content = fs.readFileSync(outPath, 'utf8');
                return content.includes('Alice') && content.includes('Carol') && content.includes('Eve')
                    && !content.includes('Bob') && !content.includes('Dave');
            },
        },
        {
            id: 'csv-filter-90',
            skill: 'csv-filter',
            skillName: 'csv-filter-anthropic',
            description: 'Filter CSV rows with Score >= 90',
            prompt: `Filter the CSV at ${filterInput}. Keep only rows where Score is at least 90. Save the result to ${path.join(workspace, 'top.csv')}. Tell me how many rows were kept.`,
            validate: (text) => text.includes('1'),
            validateFile: () => {
                const outPath = path.join(workspace, 'top.csv');
                if (!fs.existsSync(outPath)) return false;
                const content = fs.readFileSync(outPath, 'utf8');
                return content.includes('Carol') && !content.includes('Alice') && !content.includes('Bob');
            },
        },
    ];
}

// ─────────────────────────────────────────────────────────────────────────────
// Run a case via RecursiveSkilledAgent
// ─────────────────────────────────────────────────────────────────────────────

async function runCase(sessionType, testCase, runIndex, options = {}) {
    const { debug = false, mode = 'plan', toolMode = null, direct = false } = options;
    const started = Date.now();

    const agent = new LLMAgent({ name: `ASB-${sessionType}-${testCase.id}-run${runIndex + 1}` });

    // Remap all non-planner calls → toolMode for inner skill execution
    if (toolMode) {
        const originalComplete = agent.complete.bind(agent);
        agent.complete = function (opts = {}) {
            if (opts.mode !== mode) {
                return originalComplete({ ...opts, mode: toolMode });
            }
            return originalComplete(opts);
        };
    }

    const debugLogger = debug ? {
        log: (tag, data) => console.log(`${COLORS.DIM}  [DBG] ${tag}: ${JSON.stringify(data).slice(0, 300)}${COLORS.RESET}`),
    } : null;

    const rsa = new RecursiveSkilledAgent({
        llmAgent: agent,
        startDir: __dirname,
        searchUpwards: false,
        additionalSkillRoots: [SKILLS_ROOT],
        sessionType,
        maxStepsPerTurn: 15,
        debugLogger,
    });

    try {
        if (debug && runIndex === 0) {
            const allSkills = rsa.registry.getAll();
            const anthropicSkills = allSkills.filter(s => s.type === 'anthropic');
            console.log(`${COLORS.CYAN}[${sessionType}] ${anthropicSkills.length} anthropic skills: ${anthropicSkills.map(s => s.shortName).join(', ')}${COLORS.RESET}`);
        }

        const nonce = `\n<!-- [bench-${Date.now()}-${Math.random().toString(36).slice(2, 8)}] -->`;

        const execOptions = {
            context: { sessionId: `bench-${testCase.id}-${runIndex}` },
            mode,
        };

        // In direct mode, pass explicit skillName (bypasses outer routing loop)
        if (direct && testCase.skillName) {
            execOptions.skillName = testCase.skillName;
        }

        const result = await rsa.executePrompt(testCase.prompt + nonce, execOptions);
        const text = coerceResultToText(result?.result ?? result);

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

        if (debug && !ok) {
            console.log(`${COLORS.LIGHT_RED}  Failures: ${failures.join('; ')}${COLORS.RESET}`);
            console.log(`${COLORS.DIM}  Result (300 chars): ${text.slice(0, 300)}${COLORS.RESET}`);
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
            console.log(`${COLORS.LIGHT_RED}  Error: ${error?.message || String(error)}${COLORS.RESET}`);
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
    let session = 'loop';
    let mode = 'plan';
    let toolMode = null;
    let direct = false;
    let skillFilter = null;

    if (args.includes('--help') || args.includes('-h')) {
        console.log([
            'Usage: node evalsSuite/anthropic-skills/evalAnthropicSkills.mjs [options]',
            '',
            'Tests the full two-level stack: outer routing → SKILL.md skills → inner LoopAgentSession',
            '',
            '8 skills tested:',
            '  get-resource:  pdf-lite, docx-lite, json-lint',
            '  run-script:    xlsx-lite, text-stats, csv-filter',
            '  no tools:      pptx-lite, meeting-notes',
            '',
            'Options:',
            '  --session <loop|sop|json|md|both|all>  Session type (default: loop)',
            '  --mode, -m <tier>          LLM tier for planner (default: plan)',
            '  --tool-mode <tier>         LLM tier for tool execution (overrides fast)',
            '  --direct                   Bypass routing — pass explicit skillName',
            '  --skill <name>             Run only cases for this skill (e.g. pdf-lite)',
            '  --times, -t <N>            Run each case N times (default: 1)',
            '  --case, -c <N>             Run only case number N (1-16)',
            '  --debug, -d                Show debug output',
            '  --help, -h                 Show this help message',
        ].join('\n'));
        process.exit(0);
    }

    for (let i = 0; i < args.length; i += 1) {
        const arg = args[i];
        if (arg === '--debug' || arg === '-d') {
            debug = true;
        } else if (arg === '--direct') {
            direct = true;
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
        } else if (arg === '--skill') {
            skillFilter = (args[i + 1] || '').toLowerCase();
            i += 1;
        }
    }

    return { times, debug, caseNum, session, mode, toolMode, direct, skillFilter };
}

function printRunResult(sessionType, testCase, result) {
    const color = result.ok ? COLORS.GREEN : COLORS.RED;
    const inputTokens = charsToTokens(result.inputChars);
    const outputTokens = charsToTokens(result.outputChars);
    const status = result.ok ? 'PASS' : 'FAIL';
    const failText = !result.ok && result.failures.length ? ` | ${result.failures.join('; ').slice(0, 120)}` : '';
    console.log(`${color}  [${sessionType}] ${status} ${result.durationMs}ms | ${inputTokens}→${outputTokens} tok | ${result.subsystem}${failText}${COLORS.RESET}`);
}

function printSummary(totals, perSkill) {
    console.log('\n==== Anthropic Skills Benchmark Summary ====\n');

    // Per-session summary
    for (const [key, stats] of Object.entries(totals)) {
        const totalSeconds = (stats.durationMs / 1000).toFixed(1);
        const inputHuman = formatBytesFromChars(stats.inputChars);
        const outputHuman = formatBytesFromChars(stats.outputChars);
        const passRate = stats.runs > 0 ? `${Math.round((1 - stats.failures / stats.runs) * 100)}%` : 'N/A';
        console.log(`${key}: ${passRate} pass (${stats.runs - stats.failures}/${stats.runs}) | ${totalSeconds}s | in=${inputHuman} out=${outputHuman}`);
    }

    // Per-skill breakdown
    console.log('\nPer-skill breakdown:');
    const skillNames = [...new Set(Object.keys(perSkill).map(k => k.split(':')[1]))].sort();
    const sessionTypes = [...new Set(Object.keys(perSkill).map(k => k.split(':')[0]))];

    // Header
    const header = ['  Skill'.padEnd(20) + sessionTypes.map(s => s.padStart(8)).join('')];
    console.log(header.join(''));
    console.log('  ' + '─'.repeat(18 + sessionTypes.length * 8));

    for (const skill of skillNames) {
        let line = `  ${skill}`.padEnd(20);
        for (const st of sessionTypes) {
            const key = `${st}:${skill}`;
            const stats = perSkill[key];
            if (stats) {
                const passed = stats.runs - stats.failures;
                const rate = `${passed}/${stats.runs}`;
                const color = stats.failures === 0 ? COLORS.GREEN : stats.failures === stats.runs ? COLORS.RED : COLORS.YELLOW;
                line += `${color}${rate.padStart(8)}${COLORS.RESET}`;
            } else {
                line += '     N/A';
            }
        }
        console.log(line);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
    const { times, debug, caseNum, session, mode, toolMode, direct, skillFilter } = parseArgs();
    const sessionTypes = session === 'both' ? ['loop', 'sop']
        : session === 'all' ? ['loop', 'sop', 'json', 'md']
        : [session];

    const toolModeLabel = toolMode ? ` | tool-mode: ${toolMode}` : '';
    const directLabel = direct ? ' | DIRECT (no routing)' : '';
    const skillLabel = skillFilter ? ` | skill: ${skillFilter}` : '';
    console.log(`[Anthropic Skills Benchmark] sessions: ${sessionTypes.join(', ')} | mode: ${mode}${toolModeLabel}${directLabel}${skillLabel} | runs: ${times}${debug ? ' (debug)' : ''}`);

    // Create temp workspace
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'anthropic-bench-'));
    const workspace = path.join(tempRoot, 'workspace');
    ensureDir(workspace);

    try {
        let cases = buildTestCases(workspace);

        // Filter by case number
        if (caseNum) {
            cases = cases.filter((_, i) => i + 1 === caseNum);
        }

        // Filter by skill name
        if (skillFilter) {
            cases = cases.filter(c => c.skill === skillFilter);
        }

        if (!cases.length) {
            console.log('No test cases to run.');
            return;
        }

        console.log(`Running ${cases.length} test cases × ${sessionTypes.length} session types × ${times} runs = ${cases.length * sessionTypes.length * times} total executions\n`);

        const totals = {};
        const perSkill = {};
        for (const st of sessionTypes) {
            totals[st] = { runs: 0, failures: 0, durationMs: 0, inputChars: 0, outputChars: 0 };
        }

        for (const testCase of cases) {
            for (let runIndex = 0; runIndex < times; runIndex += 1) {
                const runLabel = times > 1 ? ` (${runIndex + 1}/${times})` : '';
                console.log(`${COLORS.YELLOW}[${testCase.skill}] ${testCase.id}${runLabel}: ${testCase.description}${COLORS.RESET}`);

                for (const st of sessionTypes) {
                    // Clean up output files from previous runs
                    const outputFiles = ['sales_out.csv', 'scores_totals.csv', 'passing.csv', 'top.csv'];
                    for (const f of outputFiles) {
                        const p = path.join(workspace, f);
                        if (fs.existsSync(p)) fs.unlinkSync(p);
                    }

                    const progress = debug
                        ? { stop: () => {} }
                        : startProgress(`${st}: ${testCase.id}`);

                    const result = await runCase(st, testCase, runIndex, {
                        debug,
                        mode,
                        toolMode,
                        direct,
                    });
                    progress.stop();
                    printRunResult(st, testCase, result);

                    totals[st].runs += 1;
                    totals[st].durationMs += result.durationMs;
                    totals[st].inputChars += result.inputChars;
                    totals[st].outputChars += result.outputChars;
                    if (!result.ok) totals[st].failures += 1;

                    // Per-skill tracking
                    const skillKey = `${st}:${testCase.skill}`;
                    if (!perSkill[skillKey]) {
                        perSkill[skillKey] = { runs: 0, failures: 0, durationMs: 0 };
                    }
                    perSkill[skillKey].runs += 1;
                    perSkill[skillKey].durationMs += result.durationMs;
                    if (!result.ok) perSkill[skillKey].failures += 1;
                }
            }
        }

        printSummary(totals, perSkill);
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
}

main().catch((err) => {
    console.error('[Anthropic Skills Benchmark] Fatal error:', err);
    process.exit(1);
});
