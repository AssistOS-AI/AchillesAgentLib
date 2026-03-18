#!/usr/bin/env node
/**
 * Multi-Skill Parallel Execution Benchmark
 *
 * Tests multi-step tasks that require 2-3 independent skill invocations.
 * Designed to measure plan-vs-execution timing and demonstrate SOP's
 * parallel execution advantage (via topological dependency batching).
 *
 * Uses the same 8 SKILL.md skills from evalsSuite/anthropic-skills/skills/.
 *
 * Usage:
 *   node evalsSuite/modelBenchmark/evalMultiSkillBenchmark.mjs [options]
 *
 * Options:
 *   --session <loop|sop|json|md|both|all>  Session type (default: all)
 *   --mode, -m <tier>          LLM tier for planner (default: plan)
 *   --plan-model <model>       Specific model for plan generation
 *   --tool-mode <tier>         LLM tier for tool execution (overrides fast)
 *   --times, -t <N>            Run each case N times (default: 1)
 *   --case, -c <N>             Run only case number N
 *   --debug, -d                Show debug output
 *   --help, -h                 Show this help message
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { RecursiveSkilledAgent } = await import('../../RecursiveSkilledAgents/RecursiveSkilledAgent.mjs');
const { LLMAgent } = await import('../../LLMAgents/LLMAgent.mjs');

const SKILLS_ROOT = path.join(__dirname, '..', 'anthropic-skills', 'skills');

const C = {
    RESET: '\x1b[0m', RED: '\x1b[31m', GREEN: '\x1b[32m',
    YELLOW: '\x1b[33m', CYAN: '\x1b[36m', DIM: '\x1b[2m', LIGHT_RED: '\x1b[91m',
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }
function writeFile(p, content) { ensureDir(path.dirname(p)); fs.writeFileSync(p, content, 'utf8'); }

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

function charsToTokens(chars) { return Math.ceil((chars || 0) / 4); }

function formatBytes(chars) {
    const b = chars || 0;
    if (b >= 1_048_576) return `${(b / 1_048_576).toFixed(2)} MB`;
    if (b >= 1024) return `${(b / 1024).toFixed(2)} KB`;
    return `${b} B`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Test cases — multi-skill, parallel-friendly
// ─────────────────────────────────────────────────────────────────────────────

function buildTestCases(workspace) {
    const csvSales = path.join(workspace, 'sales.csv');
    writeFile(csvSales, 'Product,Revenue\nWidget,200\nGadget,150\nDoohickey,50\n');

    const csvScores = path.join(workspace, 'scores.csv');
    writeFile(csvScores, 'Student,Score\nAlice,85\nBob,42\nCarol,91\nDave,67\nEve,73\n');

    const textShort = path.join(workspace, 'sample.txt');
    writeFile(textShort, 'The quick brown fox jumps over the lazy dog. Pack my box with five dozen liquor jugs. How vexingly quick daft zebras jump.');

    const textArticle = path.join(workspace, 'article.txt');
    writeFile(textArticle, 'Artificial intelligence is transforming industries worldwide. Companies are investing billions in AI research and development. The impact on productivity has been significant. However, ethical concerns remain a key challenge for the industry.');

    return [
        // ── 2-way parallel: text-stats + csv-filter ──────────────────────────
        {
            id: 'par2-stats-filter',
            branches: 2,
            description: 'Text stats AND CSV filter in parallel → combine',
            prompt: `Do two independent tasks and combine the results:\n1. Compute text statistics for the file at ${textShort}\n2. Filter the CSV at ${csvScores}, keep rows where Score >= 80, save to ${path.join(workspace, 'par2_pass.csv')}\nReturn both: the text stats AND the number of rows kept.`,
            validate: (text) => {
                const l = text.toLowerCase();
                return l.includes('word') && (l.includes('2') || l.includes('kept') || l.includes('rows'));
            },
        },

        // ── 2-way parallel: pdf-lite + json-lint ─────────────────────────────
        {
            id: 'par2-pdf-json',
            branches: 2,
            description: 'Validate PDF AND JSON in parallel → combine',
            prompt: 'Do two independent tasks and combine the results:\n1. Check this PDF text against your checklist:\nTitle: Quarterly Report\nOverview: Sales increased 20%.\nFindings: New markets opened in APAC.\nConclusion: Expand team.\n2. Validate this JSON:\n```json\n{"name": "app", "version": "1.0", "entries": [{"id": 1, "label": "X"}]}\n```\nReturn both results: the PDF check and the JSON validation.',
            validate: (text) => {
                const l = text.toLowerCase();
                const hasPdf = (l.match(/pass/g) || []).length >= 2;
                const hasJson = l.includes('valid');
                return hasPdf && hasJson;
            },
        },

        // ── 2-way parallel: csv-filter + xlsx-sum ────────────────────────────
        {
            id: 'par2-filter-sum',
            branches: 2,
            description: 'Filter CSV AND sum CSV in parallel',
            prompt: `Do two independent tasks:\n1. Filter the CSV at ${csvScores}, keep rows where Score >= 70, save to ${path.join(workspace, 'par2_pass70.csv')}\n2. Sum the Revenue column in ${csvSales}, save to ${path.join(workspace, 'par2_rev.csv')}\nReturn both: the number of filtered rows and the total revenue.`,
            validate: (text) => {
                const l = text.toLowerCase();
                return (l.includes('3') || l.includes('three')) && (l.includes('400') || l.includes('total'));
            },
        },

        // ── 2-way parallel: meeting-notes + pptx-lite ────────────────────────
        {
            id: 'par2-meeting-pptx',
            branches: 2,
            description: 'Meeting notes AND slide outline in parallel',
            prompt: 'Do two independent tasks and combine the results:\n1. Structure these meeting notes: "Team met Monday. Alice will fix the login bug. Bob will deploy staging. Decision: release Thursday."\n2. Create a 3-slide outline about "Sprint Retrospective". Slide 1 title, slide 2 what went well, slide 3 improvements.\nReturn both results.',
            validate: (text) => {
                const l = text.toLowerCase();
                const hasMeeting = l.includes('action') || l.includes('decision');
                const hasSlides = l.includes('slide 1') || l.includes('slide 2');
                return hasMeeting && hasSlides;
            },
        },

        // ── 3-way parallel: text-stats + csv-filter + meeting-notes ──────────
        {
            id: 'par3-stats-filter-meeting',
            branches: 3,
            description: 'Text stats + CSV filter + meeting notes in parallel',
            prompt: `Do three independent tasks and combine the results:\n1. Compute text statistics for ${textArticle}\n2. Filter the CSV at ${csvScores}, keep rows where Score >= 90, save to ${path.join(workspace, 'par3_top.csv')}\n3. Structure these meeting notes: "Sprint review with Sarah, Mike, Lisa. Mike finished the API. Lisa needs more time for UI. Decision: extend sprint by 2 days."\nReturn all three results.`,
            validate: (text) => {
                const l = text.toLowerCase();
                const hasStats = l.includes('word') || l.includes('sentence');
                const hasFilter = l.includes('1') || l.includes('carol') || l.includes('row');
                const hasMeeting = l.includes('action') || l.includes('decision') || l.includes('extend');
                return [hasStats, hasFilter, hasMeeting].filter(Boolean).length >= 2;
            },
        },

        // ── 3-way parallel: pdf + json + docx ────────────────────────────────
        {
            id: 'par3-pdf-json-docx',
            branches: 3,
            description: 'PDF check + JSON validate + draft memo in parallel',
            prompt: 'Do three independent tasks and combine the results:\n1. Check this PDF text against your checklist:\nTitle: Budget Report\nOverview: Under budget by 5%.\nFindings: Travel costs reduced.\nConclusion: Maintain current budget.\n2. Validate this JSON: {"name": "pkg", "version": "3.0", "entries": [{"id": 1, "label": "A"}, {"id": 2, "label": "B"}]}\n3. Draft a memo titled "Weekly Update". Summary: All tasks on track. Action items: Continue current work.\nReturn all three results.',
            validate: (text) => {
                const l = text.toLowerCase();
                const hasPdf = l.includes('pass');
                const hasJson = l.includes('valid');
                const hasMemo = l.includes('weekly update') || l.includes('memo');
                return [hasPdf, hasJson, hasMemo].filter(Boolean).length >= 2;
            },
        },

        // ── 3-way parallel: xlsx-sum + text-stats + pptx ─────────────────────
        {
            id: 'par3-sum-stats-pptx',
            branches: 3,
            description: 'Sum CSV + text stats + slide outline in parallel',
            prompt: `Do three independent tasks and combine the results:\n1. Sum the Revenue column in ${csvSales}, save to ${path.join(workspace, 'par3_rev.csv')}\n2. Compute text statistics for ${textShort}\n3. Create a 3-slide outline about "Data Summary". Slide 1 title, slide 2 key metrics, slide 3 next steps.\nReturn all three results.`,
            validate: (text) => {
                const l = text.toLowerCase();
                const hasSum = l.includes('400') || l.includes('total');
                const hasStats = l.includes('word') || l.includes('sentence');
                const hasSlides = l.includes('slide');
                return [hasSum, hasStats, hasSlides].filter(Boolean).length >= 2;
            },
        },

        // ── Sequential chain: filter → stats on result ───────────────────────
        {
            id: 'seq-filter-then-stats',
            branches: 1,
            description: 'Filter CSV first, then compute stats on result (sequential)',
            prompt: `First, filter the CSV at ${csvScores}, keep rows where Score >= 70, save to ${path.join(workspace, 'seq_pass.csv')}. Then compute text statistics on the filtered output file at ${path.join(workspace, 'seq_pass.csv')}. Return the text stats of the filtered file.`,
            validate: (text) => {
                const l = text.toLowerCase();
                return l.includes('word') || l.includes('character') || l.includes('sentence');
            },
        },
    ];
}

// ─────────────────────────────────────────────────────────────────────────────
// Run a case
// ─────────────────────────────────────────────────────────────────────────────

async function runCase(sessionType, testCase, runIndex, options = {}) {
    const { debug = false, mode = 'plan', planModel = null, toolMode = null } = options;
    const started = Date.now();

    const agent = new LLMAgent({ name: `MSB-${sessionType}-${testCase.id}-r${runIndex + 1}` });

    if (toolMode) {
        const orig = agent.complete.bind(agent);
        agent.complete = function (opts = {}) {
            // Remap all non-planner calls to toolMode.
            // The outer planner uses the mode passed via --mode flag;
            // inner skill execution uses 'fast' or 'plan' which we redirect.
            if (opts.mode !== mode) return orig({ ...opts, mode: toolMode });
            return orig(opts);
        };
    }

    const rsa = new RecursiveSkilledAgent({
        llmAgent: agent,
        startDir: path.join(__dirname, '..', 'anthropic-skills'),
        searchUpwards: false,
        additionalSkillRoots: [SKILLS_ROOT],
        sessionType,
        maxStepsPerTurn: 20,
        ...(planModel ? { planModel } : {}),
    });

    try {
        const nonce = `\n<!-- [bench-${Date.now()}-${Math.random().toString(36).slice(2, 8)}] -->`;
        const result = await rsa.executePrompt(testCase.prompt + nonce, {
            context: { sessionId: `mbench-${testCase.id}-${runIndex}` },
            mode,
        });
        const text = coerceResultToText(result?.result ?? result);
        const ok = testCase.validate ? testCase.validate(text) : true;
        const metrics = result?.metrics || {};

        if (debug && !ok) {
            console.log(`${C.LIGHT_RED}  Failures: content validation failed${C.RESET}`);
            console.log(`${C.DIM}  Result (300 chars): ${text.slice(0, 300)}${C.RESET}`);
        }

        rsa.shutdown();
        return {
            ok,
            durationMs: Date.now() - started,
            inputChars: agent.getInputCounter(),
            outputChars: agent.getOutputCounter(),
            planTimeMs: metrics.planTimeMs || 0,
            execTimeMs: metrics.execTimeMs || 0,
            planAttempts: metrics.planAttempts || 0,
            subsystem: result?.subsystem || 'unknown',
            error: null,
        };
    } catch (error) {
        if (debug) {
            console.log(`${C.LIGHT_RED}  Error: ${error?.message?.slice(0, 200) || String(error).slice(0, 200)}${C.RESET}`);
        }
        rsa.shutdown();
        return {
            ok: false,
            durationMs: Date.now() - started,
            inputChars: agent.getInputCounter(),
            outputChars: agent.getOutputCounter(),
            planTimeMs: 0, execTimeMs: 0, planAttempts: 0,
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
    let times = 1, debug = false, caseNum = null, session = 'all';
    let mode = 'plan', planModel = null, toolMode = null;

    if (args.includes('--help') || args.includes('-h')) {
        console.log([
            'Usage: node evalsSuite/modelBenchmark/evalMultiSkillBenchmark.mjs [options]',
            '',
            'Multi-skill parallel execution benchmark.',
            'Tests 2-way and 3-way parallel skill invocations across session types.',
            '',
            'Options:',
            '  --session <loop|sop|json|md|both|all>  Session type (default: all)',
            '  --mode, -m <tier>            LLM tier for planner (default: plan)',
            '  --plan-model <model>         Specific model for plan generation',
            '  --tool-mode <tier>           LLM tier for tool execution (overrides fast)',
            '  --times, -t <N>              Run each case N times (default: 1)',
            '  --case, -c <N>               Run only case number N',
            '  --debug, -d                  Show debug output',
        ].join('\n'));
        process.exit(0);
    }

    for (let i = 0; i < args.length; i += 1) {
        const arg = args[i];
        if (arg === '--debug' || arg === '-d') { debug = true; }
        else if (arg === '--times' || arg === '-t') {
            const v = Number.parseInt(args[i + 1], 10);
            if (Number.isFinite(v) && v > 0) { times = v; i += 1; }
        } else if (arg === '--case' || arg === '-c') {
            const v = Number.parseInt(args[i + 1], 10);
            if (Number.isFinite(v) && v > 0) { caseNum = v; i += 1; }
        } else if (arg === '--session' || arg === '-s') {
            const v = (args[i + 1] || '').toLowerCase();
            if (['loop', 'sop', 'json', 'md', 'both', 'all'].includes(v)) { session = v; i += 1; }
        } else if (arg === '--mode' || arg === '-m') {
            const v = args[i + 1] || '';
            if (v) { mode = v; i += 1; }
        } else if (arg === '--plan-model') {
            const v = args[i + 1] || '';
            if (v) { planModel = v; i += 1; }
        } else if (arg === '--tool-mode') {
            const v = args[i + 1] || '';
            if (v) { toolMode = v; i += 1; }
        }
    }

    return { times, debug, caseNum, session, mode, planModel, toolMode };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
    const { times, debug, caseNum, session, mode, planModel, toolMode } = parseArgs();
    const sessionTypes = session === 'both' ? ['loop', 'sop']
        : session === 'all' ? ['loop', 'sop', 'json', 'md']
        : [session];

    const labels = [
        `mode: ${mode}`,
        planModel ? `plan-model: ${planModel}` : null,
        toolMode ? `tool-mode: ${toolMode}` : null,
    ].filter(Boolean).join(' | ');

    console.log(`[Multi-Skill Benchmark] sessions: ${sessionTypes.join(', ')} | ${labels} | runs: ${times}${debug ? ' (debug)' : ''}`);

    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'multi-bench-'));
    const workspace = path.join(tempRoot, 'workspace');
    ensureDir(workspace);

    try {
        let cases = buildTestCases(workspace);
        if (caseNum) cases = cases.filter((_, i) => i + 1 === caseNum);

        if (!cases.length) {
            console.log('No test cases to run.');
            return;
        }

        const totalExecs = cases.length * sessionTypes.length * times;
        console.log(`Running ${cases.length} test cases × ${sessionTypes.length} session types × ${times} runs = ${totalExecs} total executions\n`);

        const totals = {};
        const perCase = {};
        for (const st of sessionTypes) {
            totals[st] = { runs: 0, failures: 0, durationMs: 0, inputChars: 0, outputChars: 0, planTimeMs: 0, execTimeMs: 0 };
        }

        for (const tc of cases) {
            for (let ri = 0; ri < times; ri += 1) {
                const runLabel = times > 1 ? ` (${ri + 1}/${times})` : '';
                console.log(`${C.YELLOW}[${tc.branches}p] ${tc.id}${runLabel}: ${tc.description}${C.RESET}`);

                // Clean output files
                const outFiles = fs.readdirSync(workspace).filter(f => f.startsWith('par') || f.startsWith('seq'));
                for (const f of outFiles) { try { fs.unlinkSync(path.join(workspace, f)); } catch {} }

                for (const st of sessionTypes) {
                    const result = await runCase(st, tc, ri, { debug, mode, planModel, toolMode });

                    // Print result
                    const color = result.ok ? C.GREEN : C.RED;
                    const status = result.ok ? 'PASS' : 'FAIL';
                    const pe = `plan=${result.planTimeMs}ms exec=${result.execTimeMs}ms`;
                    const tok = `${charsToTokens(result.inputChars)}→${charsToTokens(result.outputChars)} tok`;
                    const failText = !result.ok ? ` | ${(result.error || 'validation failed').slice(0, 80)}` : '';
                    console.log(`${color}  [${st}] ${status} ${result.durationMs}ms | ${pe} | ${tok}${failText}${C.RESET}`);

                    // Accumulate
                    totals[st].runs += 1;
                    totals[st].durationMs += result.durationMs;
                    totals[st].inputChars += result.inputChars;
                    totals[st].outputChars += result.outputChars;
                    totals[st].planTimeMs += result.planTimeMs;
                    totals[st].execTimeMs += result.execTimeMs;
                    if (!result.ok) totals[st].failures += 1;

                    const ck = `${st}:${tc.id}`;
                    if (!perCase[ck]) perCase[ck] = { runs: 0, failures: 0, durationMs: 0, planTimeMs: 0, execTimeMs: 0, branches: tc.branches };
                    perCase[ck].runs += 1;
                    perCase[ck].durationMs += result.durationMs;
                    perCase[ck].planTimeMs += result.planTimeMs;
                    perCase[ck].execTimeMs += result.execTimeMs;
                    if (!result.ok) perCase[ck].failures += 1;
                }
            }
        }

        // ── Summary ──────────────────────────────────────────────────────────
        console.log('\n==== Multi-Skill Benchmark Summary ====\n');

        for (const [key, s] of Object.entries(totals)) {
            const pass = s.runs - s.failures;
            const pct = s.runs > 0 ? Math.round((pass / s.runs) * 100) : 0;
            const total = (s.durationMs / 1000).toFixed(1);
            const plan = (s.planTimeMs / 1000).toFixed(1);
            const exec = (s.execTimeMs / 1000).toFixed(1);
            const planPct = s.durationMs > 0 ? Math.round((s.planTimeMs / s.durationMs) * 100) : 0;
            console.log(`${key}: ${pct}% pass (${pass}/${s.runs}) | ${total}s (plan=${plan}s ${planPct}% | exec=${exec}s) | in=${formatBytes(s.inputChars)} out=${formatBytes(s.outputChars)}`);
        }

        // Per-case breakdown
        console.log('\nPer-case breakdown:');
        const caseIds = [...new Set(Object.keys(perCase).map(k => k.split(':')[1]))];
        const header = '  Case'.padEnd(30) + sessionTypes.map(s => s.padStart(22)).join('');
        console.log(header);
        console.log('  ' + '─'.repeat(28 + sessionTypes.length * 22));

        for (const cid of caseIds) {
            let line = `  ${cid}`.padEnd(30);
            for (const st of sessionTypes) {
                const s = perCase[`${st}:${cid}`];
                if (!s) { line += '                   N/A'; continue; }
                const pass = s.runs - s.failures;
                const avgExec = s.runs > 0 ? Math.round(s.execTimeMs / s.runs) : 0;
                const avgPlan = s.runs > 0 ? Math.round(s.planTimeMs / s.runs) : 0;
                const color = s.failures === 0 ? C.GREEN : s.failures === s.runs ? C.RED : C.YELLOW;
                line += `${color}${`${pass}/${s.runs}`.padStart(5)} p=${avgPlan}ms e=${avgExec}ms${C.RESET}`;
            }
            console.log(line);
        }

    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
}

main().catch((err) => {
    console.error('[Multi-Skill Benchmark] Fatal error:', err);
    process.exit(1);
});
