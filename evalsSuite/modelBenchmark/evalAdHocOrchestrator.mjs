#!/usr/bin/env node
/**
 * Ad-Hoc Orchestrator Benchmark
 *
 * Tests the fallback orchestrator's ability to coordinate multiple skills
 * when no explicit orchestrator (oskill.md) is registered.
 *
 * Measures:
 * - Skill invocation accuracy (did the orchestrator call the expected skills?)
 * - Multi-skill coordination (can it chain results between skills?)
 * - Session type comparison (loop vs SOP)
 * - Latency and token usage
 *
 * Usage:
 *   node evalsSuite/modelBenchmark/evalAdHocOrchestrator.mjs [options]
 *
 * Options:
 *   --models "model1,model2"   Test specific models (default: plan tier models)
 *   --tier <name>              Test models from a specific tier (e.g. test-fast, plan, deep)
 *   --all-models               Test all available models (not just plan tier)
 *   --session-type loop|sop    Session type to test (default: both)
 *   --cases "1-3" or "2"       Case range to run
 *   --runs N                   Runs per case (default: 1)
 *   --output file.json         Save results to JSON
 *   --timeout N                Model timeout in ms (default: 60000)
 *   --soul-gateway             Only use soul_gateway models
 *   --free                     Only use free models (soul_gateway isFree flag)
 *   --healthy                  Only use models passing latest health check (<3s latency)
 *   --enable-summary           Enable conversation summary generation after each execution
 *
 * Examples:
 *   # Test with test-fast tier:
 *   node evalsSuite/modelBenchmark/evalAdHocOrchestrator.mjs --tier test-fast
 *
 *   # Test free soul gateway models (healthy only):
 *   node evalsSuite/modelBenchmark/evalAdHocOrchestrator.mjs --soul-gateway --free --healthy
 *
 *   # Test all soul gateway models:
 *   node evalsSuite/modelBenchmark/evalAdHocOrchestrator.mjs --soul-gateway --all-models
 *
 *   # Test specific models with SOP session only:
 *   node evalsSuite/modelBenchmark/evalAdHocOrchestrator.mjs --models "soul_gateway/plan,soul_gateway/fast" --session-type sop
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { RecursiveSkilledAgent } from '../../RecursiveSkilledAgents/RecursiveSkilledAgent.mjs';
import { LLMAgent } from '../../LLMAgents/LLMAgent.mjs';
import { loadModelsConfiguration, resolveModelName } from '../../utils/LLMClient.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CASES_DIR = path.join(__dirname, 'adHocCases');
const SKILLS_DIR = path.join(__dirname, '..', '..', 'tests', 'recursiveAgent', 'adHocFixtures');
const INTERNAL_SKILLS_DIR = path.join(__dirname, '..', '..', 'skills');

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

const CONFIG = {
    defaultRuns: 1,
    modelTimeout: 60_000,
    sessionTypes: ['loop', 'sop'],
};

// ─────────────────────────────────────────────────────────────────────────────
// Skills for the benchmark (descriptions used by the orchestrator)
// ─────────────────────────────────────────────────────────────────────────────

const BENCHMARK_SKILLS = {
    summarizer: {
        description: 'Summarizes long text into concise bullet points.',
        handler: async (_agent, promptText) => {
            return `Summary: ${promptText.slice(0, 100)}... [condensed]`;
        },
    },
    classifier: {
        description: 'Classifies text into categories: technology, science, business, health, other.',
        handler: async (_agent, promptText) => {
            const lower = promptText.toLowerCase();
            if (lower.includes('health') || lower.includes('disease') || lower.includes('medical')) return 'health';
            if (lower.includes('quantum') || lower.includes('satellite') || lower.includes('space')) return 'science';
            if (lower.includes('ai') || lower.includes('machine learning') || lower.includes('computing')) return 'technology';
            if (lower.includes('market') || lower.includes('revenue') || lower.includes('business')) return 'business';
            return 'other';
        },
    },
    translator: {
        description: 'Translates text between languages. Supports French, German, Spanish to English.',
        handler: async (_agent, promptText) => {
            return `[Translated to English]: ${promptText.slice(0, 150)}`;
        },
    },
};

// ─────────────────────────────────────────────────────────────────────────────
// Test case loading
// ─────────────────────────────────────────────────────────────────────────────

function loadCases(caseRange) {
    const files = fs.readdirSync(CASES_DIR)
        .filter(f => f.startsWith('case_') && f.endsWith('.json'))
        .sort();

    let cases = files.map(f => {
        const raw = fs.readFileSync(path.join(CASES_DIR, f), 'utf-8');
        return JSON.parse(raw);
    });

    if (caseRange) {
        const parts = caseRange.split('-').map(Number);
        const start = parts[0] || 1;
        const end = parts[1] || start;
        cases = cases.filter(c => {
            const num = parseInt(c.id.replace('case_', ''), 10);
            return num >= start && num <= end;
        });
    }

    return cases;
}

// ─────────────────────────────────────────────────────────────────────────────
// Model resolution
// ─────────────────────────────────────────────────────────────────────────────

function loadWorkingModels(maxLatencyMs = null) {
    const files = fs.readdirSync(__dirname)
        .filter(f => f.startsWith('model-health-') && f.endsWith('.json'))
        .sort().reverse();
    if (!files.length) return null;
    try {
        const raw = JSON.parse(fs.readFileSync(path.join(__dirname, files[0]), 'utf8'));
        let working = new Set(raw.working || []);
        if (maxLatencyMs && Array.isArray(raw.results)) {
            working = new Set(
                raw.results
                    .filter(r => r.ok && r.latencyMs <= maxLatencyMs)
                    .map(r => r.model),
            );
        }
        const label = maxLatencyMs ? `${working.size} models under ${maxLatencyMs}ms` : `${working.size} working models`;
        console.log(`Loaded health check: ${files[0]} (${label})`);
        return working;
    } catch { return null; }
}

async function resolveModels(requestedModels, { soulGatewayOnly = false, allModels = false, freeOnly = false, healthy = false, tierName = null } = {}) {
    const config = await loadModelsConfiguration();
    let models = [];

    if (requestedModels) {
        // Explicit model list
        for (const name of requestedModels.split(',').map(s => s.trim()).filter(Boolean)) {
            const resolved = resolveModelName(name, config.models, config.qualifiedModels);
            const descriptor = config.models.get(resolved || name);
            if (descriptor) {
                models.push({ name: resolved || name, provider: descriptor.providerKey, tier: descriptor.tier || 'fast' });
            } else {
                console.warn(`[Warning] Model "${name}" not found in configuration.`);
            }
        }
    } else if (tierName) {
        // Resolve models from a specific tier/intent
        // First check defaults map, then fall back to tiers for backward compat
        const defaultModel = config.defaults?.get?.(tierName);
        if (defaultModel) {
            const resolved = resolveModelName(defaultModel, config.models, config.qualifiedModels);
            const name = resolved || defaultModel;
            const descriptor = config.models.get(name);
            if (descriptor) {
                models.push({ name, provider: descriptor.providerKey, tier: tierName });
            }
        }
        if (!models.length) {
            console.warn(`[Warning] No models found for "${tierName}". Available defaults: ${config.defaults ? [...config.defaults.keys()].join(', ') : 'none'}`);
        }
    } else if (allModels || freeOnly) {
        // All available models, optionally filtered to free-only
        for (const [name, descriptor] of config.models) {
            if (freeOnly && descriptor.providerKey === 'soul_gateway' && !descriptor.isFree) continue;
            const providerConfig = config.providers.get(descriptor.providerKey);
            const apiKeyEnv = descriptor.apiKeyEnv || providerConfig?.apiKeyEnv;
            if (!apiKeyEnv || process.env[apiKeyEnv]) {
                models.push({ name, provider: descriptor.providerKey, tier: descriptor.tier || 'fast' });
            }
        }
    } else {
        // Default: resolve the plan default model (orchestration uses plan intent)
        const planDefault = config.defaults?.get?.('plan');
        if (planDefault) {
            const resolved = resolveModelName(planDefault, config.models, config.qualifiedModels);
            const name = resolved || planDefault;
            const descriptor = config.models.get(name);
            if (descriptor) {
                models.push({ name, provider: descriptor.providerKey, tier: 'plan' });
            }
        }
        // Fallback: if no plan default found, use fast default or first available fast model
        if (!models.length) {
            const fastDefault = config.defaults?.get?.('fast');
            if (fastDefault) {
                const resolved = resolveModelName(fastDefault, config.models, config.qualifiedModels);
                const name = resolved || fastDefault;
                const descriptor = config.models.get(name);
                if (descriptor) {
                    models.push({ name, provider: descriptor.providerKey, tier: 'fast' });
                }
            }
        }
        if (!models.length) {
            for (const [name, descriptor] of config.models) {
                const tier = descriptor.tier || 'fast';
                if (tier === 'fast') {
                    const providerConfig = config.providers.get(descriptor.providerKey);
                    const apiKeyEnv = descriptor.apiKeyEnv || providerConfig?.apiKeyEnv;
                    if (!apiKeyEnv || process.env[apiKeyEnv]) {
                        models.push({ name, provider: descriptor.providerKey, tier });
                        break;
                    }
                }
            }
        }
    }

    if (soulGatewayOnly) {
        models = models.filter(m => m.provider === 'soul_gateway');
    }

    if (healthy) {
        const working = loadWorkingModels(3000);
        if (working) {
            models = models.filter(m => working.has(m.name));
        } else {
            console.warn('No health check results found. Run checkModels.mjs first.');
        }
    }

    return models;
}

// ─────────────────────────────────────────────────────────────────────────────
// Create agent with ad-hoc orchestration (no explicit orchestrator)
// ─────────────────────────────────────────────────────────────────────────────

function createBenchmarkAgent({ modelName, sessionType, enableSummary = false }) {
    const agent = new LLMAgent({
        name: 'AdHocBenchmark',
        invokerStrategy: null, // uses default strategy (real LLM calls)
    });

    const recursiveAgent = new RecursiveSkilledAgent({
        llmAgent: agent,
        startDir: SKILLS_DIR,
        skillFilter: ({ skillDir }) => {
            if (skillDir?.startsWith(SKILLS_DIR)) return true;
            if (skillDir?.startsWith(INTERNAL_SKILLS_DIR)) return true;
            return false;
        },
        exposeInternalSkills: false,
        fallbackSessionType: sessionType,
        enableSummary,
        tierConfig: {
            plan: 'plan',       // orchestration reasoning uses plan tier
            execution: 'fast',  // routine LLM calls use fast tier
            code: 'code',
            summary: 'fast',    // conversation summary uses fast tier
        },
    });

    return { recursiveAgent, agent };
}

// ─────────────────────────────────────────────────────────────────────────────
// Run a single benchmark case
// ─────────────────────────────────────────────────────────────────────────────

async function runCase({ testCase, sessionType, modelName, timeout, enableSummary = false }) {
    const startTime = Date.now();
    const { recursiveAgent, agent } = createBenchmarkAgent({ modelName, sessionType, enableSummary });

    try {
        // Add nonce to bypass prompt caching
        const nonce = `[bench-${Date.now()}-${Math.random().toString(36).slice(2, 8)}]`;
        const promptWithNonce = `${testCase.prompt}\n${nonce}`;

        const response = await Promise.race([
            recursiveAgent.executePrompt(promptWithNonce),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Timeout')), timeout)
            ),
        ]);

        const durationMs = Date.now() - startTime;
        const isAdHoc = response.adHoc === true;
        const sessionUsed = response.session || 'unknown';
        const result = response.result || '';
        const inputChars = agent.getInputCounter();
        const outputChars = agent.getOutputCounter();

        // Evaluate result against expected content
        const resultText = typeof result === 'string' ? result : JSON.stringify(result);
        const resultLower = resultText.toLowerCase();
        const hasResult = resultText.length > 10;

        // Check required content patterns
        const mustContain = testCase.resultMustContain || [];
        const mustNotContain = testCase.resultMustNotContain || [];
        const containHits = mustContain.filter(p => resultLower.includes(p.toLowerCase()));
        const containMisses = mustContain.filter(p => !resultLower.includes(p.toLowerCase()));
        const forbiddenHits = mustNotContain.filter(p => resultLower.includes(p.toLowerCase()));

        const contentScore = mustContain.length
            ? containHits.length / mustContain.length
            : (hasResult ? 1 : 0);
        const noForbidden = forbiddenHits.length === 0;

        const ok = isAdHoc && hasResult && contentScore >= 0.5 && noForbidden;

        recursiveAgent.shutdown();

        return {
            caseId: testCase.id,
            difficulty: testCase.difficulty,
            sessionType,
            model: modelName,
            ok,
            isAdHoc,
            sessionUsed,
            durationMs,
            inputChars,
            outputChars,
            contentScore: Math.round(contentScore * 100),
            containMisses: containMisses.length ? containMisses : undefined,
            forbiddenHits: forbiddenHits.length ? forbiddenHits : undefined,
            resultPreview: resultText.slice(0, 300),
            error: null,
        };
    } catch (error) {
        recursiveAgent.shutdown();
        return {
            caseId: testCase.id,
            difficulty: testCase.difficulty,
            sessionType,
            model: modelName,
            ok: false,
            isAdHoc: false,
            sessionUsed: sessionType,
            durationMs: Date.now() - startTime,
            inputChars: 0,
            outputChars: 0,
            resultPreview: '',
            error: error.message,
        };
    }
}

/**
 * Run a multi-turn benchmark case. Reuses the same agent so sessionMemory
 * (and conversation summary when enabled) persists across turns.
 */
async function runMultiTurnCase({ testCase, sessionType, modelName, timeout, enableSummary = false }) {
    const startTime = Date.now();
    const { recursiveAgent, agent } = createBenchmarkAgent({ modelName, sessionType, enableSummary });

    const turnResults = [];
    let allOk = true;

    try {
        for (let i = 0; i < testCase.turns.length; i++) {
            const turn = testCase.turns[i];
            const turnStart = Date.now();
            const nonce = `[bench-${Date.now()}-${Math.random().toString(36).slice(2, 8)}]`;

            const response = await Promise.race([
                recursiveAgent.executePrompt(`${turn.prompt}\n${nonce}`),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error(`Timeout on turn ${i + 1}`)), timeout)
                ),
            ]);

            const result = response?.result || '';
            const resultText = typeof result === 'string' ? result : JSON.stringify(result);
            const resultLower = resultText.toLowerCase();
            const hasResult = resultText.length > 10;

            const mustContain = turn.resultMustContain || [];
            const mustNotContain = turn.resultMustNotContain || [];
            const containHits = mustContain.filter(p => resultLower.includes(p.toLowerCase()));
            const containMisses = mustContain.filter(p => !resultLower.includes(p.toLowerCase()));
            const forbiddenHits = mustNotContain.filter(p => resultLower.includes(p.toLowerCase()));

            const contentScore = mustContain.length
                ? containHits.length / mustContain.length
                : (hasResult ? 1 : 0);
            const noForbidden = forbiddenHits.length === 0;
            const turnOk = hasResult && contentScore >= 0.5 && noForbidden;

            if (!turnOk) allOk = false;

            turnResults.push({
                turn: i + 1,
                ok: turnOk,
                contentScore: Math.round(contentScore * 100),
                containMisses: containMisses.length ? containMisses : undefined,
                forbiddenHits: forbiddenHits.length ? forbiddenHits : undefined,
                durationMs: Date.now() - turnStart,
                resultPreview: resultText.slice(0, 200),
            });
        }

        const durationMs = Date.now() - startTime;

        recursiveAgent.shutdown();

        // Overall content score = average across turns
        const avgContent = Math.round(turnResults.reduce((s, t) => s + t.contentScore, 0) / turnResults.length);

        return {
            caseId: testCase.id,
            difficulty: testCase.difficulty,
            sessionType,
            model: modelName,
            multiTurn: true,
            turnCount: testCase.turns.length,
            ok: allOk,
            isAdHoc: true,
            sessionUsed: sessionType === 'sop' ? 'sop' : 'loop',
            durationMs,
            inputChars: agent.getInputCounter(),
            outputChars: agent.getOutputCounter(),
            contentScore: avgContent,
            turns: turnResults,
            error: null,
        };
    } catch (error) {
        recursiveAgent.shutdown();
        return {
            caseId: testCase.id,
            difficulty: testCase.difficulty,
            sessionType,
            model: modelName,
            multiTurn: true,
            turnCount: testCase.turns.length,
            ok: false,
            isAdHoc: false,
            sessionUsed: sessionType,
            durationMs: Date.now() - startTime,
            inputChars: 0,
            outputChars: 0,
            contentScore: 0,
            turns: turnResults,
            error: error.message,
        };
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Results formatting
// ─────────────────────────────────────────────────────────────────────────────

function printResults(allResults) {
    const byModelAndSession = new Map();

    for (const r of allResults) {
        const key = `${r.model}|${r.sessionType}`;
        if (!byModelAndSession.has(key)) {
            byModelAndSession.set(key, { model: r.model, sessionType: r.sessionType, results: [] });
        }
        byModelAndSession.get(key).results.push(r);
    }

    console.log('\n' + '═'.repeat(90));
    console.log('  Ad-Hoc Orchestrator Benchmark Results');
    console.log('═'.repeat(90));

    const header = [
        'Model'.padEnd(35),
        'Session'.padEnd(8),
        'Pass'.padEnd(8),
        'Content'.padEnd(9),
        'Latency'.padEnd(10),
        'Cases',
    ].join(' ');
    console.log(header);
    console.log('─'.repeat(95));

    const sorted = [...byModelAndSession.values()].sort((a, b) => {
        const aPass = a.results.filter(r => r.ok).length / a.results.length;
        const bPass = b.results.filter(r => r.ok).length / b.results.length;
        if (bPass !== aPass) return bPass - aPass;
        const aContent = a.results.reduce((s, r) => s + (r.contentScore || 0), 0) / a.results.length;
        const bContent = b.results.reduce((s, r) => s + (r.contentScore || 0), 0) / b.results.length;
        if (bContent !== aContent) return bContent - aContent;
        const aLatency = a.results.reduce((s, r) => s + r.durationMs, 0) / a.results.length;
        const bLatency = b.results.reduce((s, r) => s + r.durationMs, 0) / b.results.length;
        return aLatency - bLatency;
    });

    for (const group of sorted) {
        const total = group.results.length;
        const passed = group.results.filter(r => r.ok).length;
        const avgContent = Math.round(group.results.reduce((s, r) => s + (r.contentScore || 0), 0) / total);
        const avgLatency = Math.round(group.results.reduce((s, r) => s + r.durationMs, 0) / total);
        const passRate = Math.round((passed / total) * 100);

        const passColor = passRate === 100 ? '\x1b[32m' : passRate >= 60 ? '\x1b[33m' : '\x1b[31m';
        const contentColor = avgContent === 100 ? '\x1b[32m' : avgContent >= 50 ? '\x1b[33m' : '\x1b[31m';
        const reset = '\x1b[0m';

        const line = [
            group.model.slice(0, 35).padEnd(35),
            group.sessionType.padEnd(8),
            `${passColor}${passRate}%${reset}`.padEnd(17),
            `${contentColor}${avgContent}%${reset}`.padEnd(18),
            `${avgLatency}ms`.padEnd(10),
            `${passed}/${total}`,
        ].join(' ');

        console.log(line);
    }

    console.log('─'.repeat(95));

    // Print per-case details for failures
    const failures = allResults.filter(r => !r.ok);
    if (failures.length) {
        console.log(`\n  Failures (${failures.length}):`);
        for (const f of failures) {
            if (f.multiTurn && f.turns?.length) {
                const failedTurns = f.turns.filter(t => !t.ok);
                const turnDetail = failedTurns.map(t => {
                    const reason = t.containMisses?.length ? `missing: ${t.containMisses.join(', ')}` : `content: ${t.contentScore}%`;
                    return `turn ${t.turn}: ${reason}`;
                }).join('; ');
                console.log(`    ${f.caseId} [${f.sessionType}] ${f.model}: ${f.error || turnDetail}`);
            } else {
                const reason = f.error
                    || (f.containMisses?.length ? `missing: ${f.containMisses.join(', ')}` : '')
                    || (f.forbiddenHits?.length ? `forbidden: ${f.forbiddenHits.join(', ')}` : '')
                    || `content: ${f.contentScore}%`;
                console.log(`    ${f.caseId} [${f.sessionType}] ${f.model}: ${reason}`);
            }
        }
    }

    console.log('');
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
    const args = process.argv.slice(2);
    const getArg = (flag) => {
        const idx = args.indexOf(flag);
        return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : null;
    };
    const hasFlag = (flag) => args.includes(flag);

    const requestedModels = getArg('--models');
    const sessionTypeArg = getArg('--session-type');
    const caseRange = getArg('--cases');
    const runs = parseInt(getArg('--runs') || String(CONFIG.defaultRuns), 10);
    const outputFile = getArg('--output');
    const timeout = parseInt(getArg('--timeout') || String(CONFIG.modelTimeout), 10);
    const soulGatewayOnly = hasFlag('--soul-gateway');
    const allModels = hasFlag('--all-models');
    const freeOnly = hasFlag('--free');
    const healthy = hasFlag('--healthy');
    const enableSummary = hasFlag('--enable-summary');
    const tierName = getArg('--tier');

    const sessionTypes = sessionTypeArg
        ? [sessionTypeArg]
        : CONFIG.sessionTypes;

    // Load test cases
    const testCases = loadCases(caseRange);
    if (!testCases.length) {
        console.error('No test cases found.');
        process.exit(1);
    }
    console.log(`Loaded ${testCases.length} test case(s)`);

    // Resolve models
    const models = await resolveModels(requestedModels, { soulGatewayOnly, allModels, freeOnly, healthy, tierName });
    if (!models.length) {
        console.error('No models available. Check API keys and configuration.');
        process.exit(1);
    }
    console.log(`Testing ${models.length} model(s): ${models.map(m => `${m.name} (${m.tier})`).join(', ')}`);
    console.log(`Session types: ${sessionTypes.join(', ')}`);
    console.log(`Orchestration tier: plan`);
    console.log(`Conversation summary: ${enableSummary ? 'enabled' : 'disabled'}`);
    console.log(`Runs per case: ${runs}`);
    console.log(`Timeout: ${timeout}ms`);
    console.log('');

    const allResults = [];
    const totalWork = models.length * sessionTypes.length * testCases.length * runs;
    let completed = 0;

    for (const model of models) {
        for (const sessionType of sessionTypes) {
            for (const testCase of testCases) {
                for (let run = 0; run < runs; run++) {
                    completed++;
                    const progress = Math.round((completed / totalWork) * 100);
                    process.stdout.write(`\r  [${progress}%] ${model.name} | ${sessionType} | ${testCase.id} | run ${run + 1}/${runs}    `);

                    const runner = testCase.multiTurn ? runMultiTurnCase : runCase;
                    const result = await runner({
                        testCase,
                        sessionType,
                        modelName: model.name,
                        timeout,
                        enableSummary,
                    });
                    allResults.push(result);

                    // Cooldown between calls to avoid rate limiting
                    if (completed < totalWork) {
                        await new Promise(resolve => setTimeout(resolve, 1000));
                    }
                }
            }
        }
    }

    process.stdout.write('\r' + ' '.repeat(80) + '\r');

    // Print results
    printResults(allResults);

    // Save JSON output
    if (outputFile) {
        const output = {
            timestamp: new Date().toISOString(),
            config: { runs, timeout, sessionTypes },
            models: models.map(m => ({ name: m.name, provider: m.provider, tier: m.tier })),
            testCases: testCases.map(c => ({ id: c.id, difficulty: c.difficulty, description: c.description })),
            results: allResults,
            summary: {
                total: allResults.length,
                passed: allResults.filter(r => r.ok).length,
                failed: allResults.filter(r => !r.ok).length,
                passRate: Math.round((allResults.filter(r => r.ok).length / allResults.length) * 100),
                avgLatencyMs: Math.round(allResults.reduce((s, r) => s + r.durationMs, 0) / allResults.length),
            },
        };

        const outputPath = path.isAbsolute(outputFile)
            ? outputFile
            : path.resolve(outputFile);
        fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
        console.log(`Results saved to ${outputPath}`);
    }

    // Exit with error if any failures
    const failCount = allResults.filter(r => !r.ok).length;
    if (failCount > 0) {
        process.exit(1);
    }
}

main().catch(error => {
    console.error('Benchmark failed:', error.message);
    process.exit(1);
});
