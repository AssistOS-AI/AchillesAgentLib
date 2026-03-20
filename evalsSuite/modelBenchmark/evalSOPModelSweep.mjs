#!/usr/bin/env node
/**
 * SOP Model Sweep Benchmark
 *
 * Tests the SOPLang agentic session across multiple LLM models.
 * Runs evalAgenticPerformance inline (no child fork) for reliable result capture.
 *
 * Usage:
 *   node evalsSuite/modelBenchmark/evalSOPModelSweep.mjs [options]
 *
 * Options:
 *   --competitive          Only test curated competitive models (~30)
 *   --filter <pattern>     Grep-filter discovered models
 *   --model <name>         Test a single model
 *   --times <N>            Runs per model (default: 1)
 *   --timeout <ms>         Per-model timeout (default: 300000)
 *   --help, -h             Show help
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LIB_ROOT = path.resolve(__dirname, '../..');
const EVAL_SCRIPT = path.join(LIB_ROOT, 'evalsSuite', 'evalAgenticPerformance.mjs');

const C = {
    RESET: '\x1b[0m', RED: '\x1b[31m', GREEN: '\x1b[32m',
    YELLOW: '\x1b[33m', CYAN: '\x1b[36m', DIM: '\x1b[2m',
};

const COMPETITIVE_MODELS = [
    // >= 80% SOP accuracy in previous sweep
    'claude-sonnet-4-6', 'gemini-2.5-flash-lite',
    'kiro-claude-sonnet-4.5', 'kiro-deepseek-3.2', 'kiro-qwen3-coder-next',
    'deepseek-ai/deepseek-v3.1', 'deepseek-ai/deepseek-v3.2',
    'meta/llama-3.1-405b-instruct',
    'mistralai/mistral-medium-3-instruct', 'mistralai/mistral-small-3.1-24b-instruct-2503',
    'minimaxai/minimax-m2.1', 'openai/gpt-oss-120b', 'openai/gpt-oss-20b',
    'nvidia/llama-3.1-nemotron-ultra-253b-v1', 'nvidia/llama-3.3-nemotron-super-49b-v1.5',
    'qwen/qwen3-coder-480b-a35b-instruct', 'moonshotai/kimi-k2-instruct',
];

async function discoverModels() {
    const { loadModelsConfiguration } = await import('../../utils/LLMProviders/providers/modelsConfigLoader.mjs');
    const config = await loadModelsConfiguration();
    return [...config.models.entries()]
        .filter(([, m]) => m.providerKey === 'soul_gateway')
        .map(([name]) => name);
}

function loadWorkingModels() {
    // Find the latest model-health-*.json file
    const files = fs.readdirSync(__dirname)
        .filter(f => f.startsWith('model-health-') && f.endsWith('.json'))
        .sort()
        .reverse();
    if (!files.length) return null;
    try {
        const data = JSON.parse(fs.readFileSync(path.join(__dirname, files[0]), 'utf8'));
        console.log(`${C.DIM}Loaded health check: ${files[0]} (${data.working?.length || 0} working models)${C.RESET}`);
        return new Set(data.working || []);
    } catch { return null; }
}

function runEvalForModel(model, times, timeoutMs) {
    try {
        const stdout = execFileSync('node', [
            EVAL_SCRIPT, '--mode', model, '--times', String(times), '--json',
        ], {
            cwd: LIB_ROOT,
            env: { ...process.env },
            timeout: timeoutMs,
            maxBuffer: 10 * 1024 * 1024,
            stdio: ['ignore', 'pipe', 'pipe'],
        }).toString();

        const match = stdout.match(/__JSON_RESULT__(.*)/);
        if (match) {
            return JSON.parse(match[1]);
        }
        return { model, error: 'no __JSON_RESULT__ in output' };
    } catch (err) {
        if (err.killed) return { model, error: 'timeout' };
        // Try to extract result from partial stdout
        const partial = err.stdout?.toString() || '';
        const match = partial.match(/__JSON_RESULT__(.*)/);
        if (match) {
            try { return JSON.parse(match[1]); } catch {}
        }
        return { model, error: err.message?.slice(0, 100) || 'unknown error' };
    }
}

function parseArgs() {
    const args = process.argv.slice(2);
    let filter = null, competitive = false, singleModel = null, healthy = false;
    let times = 1, timeoutMs = 300_000;

    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === '--help' || a === '-h') {
            console.log([
                'Usage: node evalsSuite/modelBenchmark/evalSOPModelSweep.mjs [options]',
                '', 'Options:',
                '  --competitive          Only test curated competitive models',
                '  --healthy              Only test models that passed health check',
                '  --filter <pattern>     Grep-filter discovered models',
                '  --model <name>         Test a single model',
                '  --times <N>            Runs per model (default: 1)',
                '  --timeout <ms>         Per-model timeout (default: 300000)',
            ].join('\n'));
            process.exit(0);
        }
        else if (a === '--competitive') competitive = true;
        else if (a === '--healthy') healthy = true;
        else if (a === '--filter') filter = args[++i];
        else if (a === '--model') singleModel = args[++i];
        else if (a === '--times' || a === '-t') times = parseInt(args[++i], 10) || 1;
        else if (a === '--timeout') timeoutMs = parseInt(args[++i], 10) || 300_000;
    }
    return { filter, competitive, healthy, singleModel, times, timeoutMs };
}

function generateMarkdown(results) {
    const lines = [
        '# SOP Model Sweep Results', '',
        `**Date:** ${new Date().toISOString().slice(0, 10)}`,
        `**Cases:** ${results[0]?.sop?.runs || '?'} (evalAgenticPerformance)`, '',
        '## Summary (sorted by SOP pass rate, then speed)', '',
        '| # | Model | SOP Pass | SOP Time | SOP Tok In | Loop Pass | Loop Time | Loop Tok In |',
        '|---|-------|----------|----------|------------|-----------|-----------|-------------|',
    ];
    const sorted = [...results].sort((a, b) => {
        const ar = a.sop?.passRate ?? -1, br = b.sop?.passRate ?? -1;
        if (br !== ar) return br - ar;
        return (a.sop?.durationMs ?? Infinity) - (b.sop?.durationMs ?? Infinity);
    });
    sorted.forEach((r, i) => {
        if (r.error) { lines.push(`| ${i+1} | ${r.model} | ERROR | — | — | — | — | ${r.error} |`); return; }
        const sp = r.sop ? `${r.sop.passRate}% (${r.sop.passed}/${r.sop.runs})` : '—';
        const st = r.sop ? `${(r.sop.durationMs/1000).toFixed(1)}s` : '—';
        const sti = r.sop ? `${Math.round(r.sop.inputChars/4)}` : '—';
        const lp = r.loop ? `${r.loop.passRate}% (${r.loop.passed}/${r.loop.runs})` : '—';
        const lt = r.loop ? `${(r.loop.durationMs/1000).toFixed(1)}s` : '—';
        const lti = r.loop ? `${Math.round(r.loop.inputChars/4)}` : '—';
        lines.push(`| ${i+1} | ${r.model} | ${sp} | ${st} | ${sti} | ${lp} | ${lt} | ${lti} |`);
    });

    // Per-case detail for each model
    for (const r of sorted) {
        if (r.error || !r.cases?.length) continue;
        lines.push('', `### ${r.model}`, '');
        lines.push('| Case | SOP | SOP ms | SOP Tok In/Out | Loop | Loop ms | Loop Tok In/Out |');
        lines.push('|------|-----|--------|----------------|------|---------|-----------------|');
        for (const c of r.cases) {
            const sopStatus = c.sop.ok ? 'PASS' : 'FAIL';
            const loopStatus = c.loop.ok ? 'PASS' : 'FAIL';
            lines.push(`| ${c.caseId} | ${sopStatus} | ${c.sop.durationMs} | ${c.sop.inputTokens}/${c.sop.outputTokens} | ${loopStatus} | ${c.loop.durationMs} | ${c.loop.inputTokens}/${c.loop.outputTokens} |`);
        }
    }

    return lines.join('\n');
}

async function main() {
    const opts = parseArgs();
    let models;
    if (opts.singleModel) models = [opts.singleModel];
    else if (opts.competitive) models = [...COMPETITIVE_MODELS];
    else models = await discoverModels();

    if (opts.filter) {
        const re = new RegExp(opts.filter, 'i');
        models = models.filter(m => re.test(m));
    }
    if (opts.healthy) {
        const working = loadWorkingModels();
        if (working) {
            models = models.filter(m => working.has(m));
        } else {
            console.log(`${C.YELLOW}No health check results found. Run checkModels.mjs first.${C.RESET}`);
        }
    }
    if (!models.length) { console.log('No models to test.'); return; }

    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const jsonPath = path.join(__dirname, `sop-model-sweep-${ts}.json`);
    const mdPath = path.join(__dirname, `sop-model-sweep-${ts}.md`);

    console.log(`${C.CYAN}[SOP Model Sweep] ${models.length} models | ${opts.times} run(s) | timeout ${opts.timeoutMs/1000}s${C.RESET}\n`);

    const results = [];
    for (let i = 0; i < models.length; i++) {
        const model = models[i];
        process.stdout.write(`${C.YELLOW}[${i+1}/${models.length}] ${model}${C.RESET} ... `);
        const t0 = Date.now();
        const result = runEvalForModel(model, opts.times, opts.timeoutMs);
        const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
        results.push(result);

        if (result.error) {
            console.log(`${C.RED}ERROR (${elapsed}s): ${result.error}${C.RESET}`);
        } else {
            const sr = result.sop?.passRate ?? '?';
            const sp = result.sop ? `${result.sop.passed}/${result.sop.runs}` : '?';
            const st = result.sop ? `${(result.sop.durationMs / 1000).toFixed(1)}s` : '?';
            const sti = result.sop ? `${Math.round(result.sop.inputChars / 4)} tok` : '';
            const lr = result.loop?.passRate ?? '?';
            const lp = result.loop ? `${result.loop.passed}/${result.loop.runs}` : '?';
            const lt = result.loop ? `${(result.loop.durationMs / 1000).toFixed(1)}s` : '?';
            const lti = result.loop ? `${Math.round(result.loop.inputChars / 4)} tok` : '';
            const sc = sr === 100 ? C.GREEN : sr >= 80 ? C.YELLOW : C.RED;
            console.log(`${sc}SOP ${sr}% (${sp}) ${st} ${sti}${C.RESET} | Loop ${lr}% (${lp}) ${lt} ${lti}`);

            // Show per-case breakdown
            if (result.cases?.length) {
                for (const c of result.cases) {
                    const sOk = c.sop.ok ? `${C.GREEN}PASS${C.RESET}` : `${C.RED}FAIL${C.RESET}`;
                    const lOk = c.loop.ok ? `${C.GREEN}PASS${C.RESET}` : `${C.RED}FAIL${C.RESET}`;
                    console.log(`${C.DIM}    ${(c.caseId || '').padEnd(30)} SOP:${sOk} ${String(c.sop.durationMs).padStart(6)}ms ${String(c.sop.inputTokens).padStart(5)}→${String(c.sop.outputTokens).padStart(4)} tok | Loop:${lOk} ${String(c.loop.durationMs).padStart(6)}ms ${String(c.loop.inputTokens).padStart(5)}→${String(c.loop.outputTokens).padStart(4)} tok${C.RESET}`);
                }
            }
        }
        fs.writeFileSync(jsonPath, JSON.stringify(results, null, 2));
    }

    fs.writeFileSync(mdPath, generateMarkdown(results));

    console.log(`\n${C.CYAN}━━━ Summary (sorted by SOP pass rate, then SOP speed) ━━━${C.RESET}`);
    console.log(`${'  Model'.padEnd(52)} ${'SOP'.padEnd(20)} ${'Loop'.padEnd(20)}`);
    console.log(`  ${'─'.repeat(86)}`);
    [...results].filter(r => !r.error && r.sop)
        .sort((a, b) => (b.sop.passRate - a.sop.passRate) || (a.sop.durationMs - b.sop.durationMs))
        .forEach(r => {
            const sc = r.sop.passRate === 100 ? C.GREEN : r.sop.passRate >= 80 ? C.YELLOW : C.RED;
            const sopLabel = `${r.sop.passRate}% (${r.sop.passed}/${r.sop.runs}) ${(r.sop.durationMs/1000).toFixed(1)}s`;
            const loopLabel = r.loop ? `${r.loop.passRate}% (${r.loop.passed}/${r.loop.runs}) ${(r.loop.durationMs/1000).toFixed(1)}s` : '—';
            console.log(`${sc}  ${r.model.padEnd(50)} ${sopLabel.padEnd(20)} ${loopLabel}${C.RESET}`);
        });
    const errs = results.filter(r => r.error).length;
    if (errs) console.log(`${C.RED}  ${errs} models errored${C.RESET}`);
    console.log(`\nJSON: ${jsonPath}\nMD:   ${mdPath}`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
