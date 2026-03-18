#!/usr/bin/env node
/**
 * NVIDIA Code Generation Benchmark
 *
 * Tests NVIDIA models on Soul Gateway for code generation quality.
 * Uses mirror-code-generator to generate code from specs, then validates
 * with syntax checks and functional tests.
 *
 * Skills tested (1 spec file each, from evalsSuite/mirror-code-gen/skills/):
 * - hash-util: cryptographic hashing and verification (uses node:crypto)
 * - schema-validator: object validation against schemas (pure JS)
 * - config-loader: config loading with type conversion (pure JS)
 *
 * For each model × skill combination, the benchmark:
 * 1. Generates code from the spec via mirror-code-generator (includes auto-repair)
 * 2. Runs `node --check` syntax validation
 * 3. Dynamically imports the generated code and runs functional tests
 * 4. Records: generation success, syntax check, test pass/fail, latency
 *
 * Usage:
 *   node evalsSuite/modelBenchmark/evalNvidiaCodeGenBenchmark.mjs [options]
 *
 * Reference models (claude-opus-4.6) are included by default for comparison.
 *
 * Options:
 *   --models <list>    Comma-separated models (default: all nvidia/* + references)
 *   --skills <list>    Comma-separated skills (default: hash-util,schema-validator,config-loader)
 *   --no-reference     Skip reference models (only test nvidia)
 *   --output <file>    Save results to JSON file
 *   --cooldown <ms>    Cooldown between models in ms (default: 0)
 *   --help             Show help
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIRROR_SKILLS_DIR = path.resolve(__dirname, '..', 'mirror-code-gen', 'skills');
const execFileAsync = promisify(execFile);

const { LLMAgent } = await import('../../LLMAgents/LLMAgent.mjs');
const { loadModelsConfiguration } = await import('../../utils/LLMClient.mjs');
const { generateMirrorCode } = await import('../../skills/mirror-code-generator/src/codegen.mjs');

const COLORS = {
    RESET: '\x1b[0m',
    RED: '\x1b[31m',
    GREEN: '\x1b[32m',
    YELLOW: '\x1b[33m',
    BLUE: '\x1b[34m',
    CYAN: '\x1b[36m',
    GRAY: '\x1b[90m',
    BOLD: '\x1b[1m',
};

// ─────────────────────────────────────────────────────────────────────────────
// Functional test suites for each skill (10 tests each)
// ─────────────────────────────────────────────────────────────────────────────

import { runTests as runHashUtilTests } from './codeGenTests/hashUtilTests.mjs';
import { runTests as runSchemaValidatorTests } from './codeGenTests/schemaValidatorTests.mjs';
import { runTests as runConfigLoaderTests } from './codeGenTests/configLoaderTests.mjs';

const SKILL_TESTS = {
    'hash-util': runHashUtilTests,
    'schema-validator': runSchemaValidatorTests,
    'config-loader': runConfigLoaderTests,
};

// ─────────────────────────────────────────────────────────────────────────────
// CLI parsing
// ─────────────────────────────────────────────────────────────────────────────

// Reference model included by default for baseline comparison.
const REFERENCE_MODELS = ['claude-opus-4-6'];

function parseArgs() {
    const args = process.argv.slice(2);
    const options = {
        models: null,
        skills: Object.keys(SKILL_TESTS),
        includeReference: true,
        outputFile: null,
        cooldown: 0,
        help: false,
    };

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--help' || arg === '-h') {
            options.help = true;
        } else if (arg === '--models' || arg === '-m') {
            options.models = args[++i]?.split(',').map(m => m.trim()).filter(Boolean) || null;
        } else if (arg === '--skills') {
            options.skills = args[++i]?.split(',').map(s => s.trim()).filter(Boolean) || options.skills;
        } else if (arg === '--no-reference') {
            options.includeReference = false;
        } else if (arg === '--output' || arg === '-o') {
            options.outputFile = args[++i];
        } else if (arg === '--cooldown') {
            options.cooldown = parseInt(args[++i], 10) || 0;
        }
    }

    return options;
}

function printHelp() {
    console.log(`
${COLORS.BOLD}NVIDIA Code Generation Benchmark${COLORS.RESET}

Tests NVIDIA models for code generation quality using mirror-code-generator.
Generates code from specs, checks syntax, and runs functional tests.

${COLORS.CYAN}Options:${COLORS.RESET}
  --models, -m <list>   Comma-separated models to test (default: all nvidia/* + references)
  --skills <list>       Skills to test (default: hash-util,schema-validator,config-loader)
  --no-reference        Skip reference models (${REFERENCE_MODELS.join(', ')})
  --output, -o <file>   Save results to JSON file
  --cooldown <ms>       Cooldown between models in ms (default: 0)
  --help, -h            Show this help

${COLORS.CYAN}Reference Models:${COLORS.RESET}
  ${REFERENCE_MODELS.join(', ')} (included by default for baseline comparison)

${COLORS.CYAN}Examples:${COLORS.RESET}
  # Test all nvidia models + reference baseline
  node evalsSuite/modelBenchmark/evalNvidiaCodeGenBenchmark.mjs

  # Test nvidia only (no reference)
  node evalsSuite/modelBenchmark/evalNvidiaCodeGenBenchmark.mjs --no-reference

  # Test specific models
  node evalsSuite/modelBenchmark/evalNvidiaCodeGenBenchmark.mjs \\
    --models "nvidia/nemotron-nano-12b-v2-vl,claude-opus-4-6"

  # Save results
  node evalsSuite/modelBenchmark/evalNvidiaCodeGenBenchmark.mjs -o nvidia-codegen-results.json
`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Model discovery
// ─────────────────────────────────────────────────────────────────────────────

function getModelsToTest(modelsConfig, requestedModels, includeReference) {
    const available = [];
    const seen = new Set();

    const referenceSet = new Set(includeReference ? REFERENCE_MODELS : []);
    const wantedSet = requestedModels ? new Set(requestedModels) : null;

    // Helper: check if a model is a NVIDIA NIM model (served via build.nvidia.com).
    // NIM models use vendor namespaces (nvidia/, meta/, qwen/, mistralai/, etc.)
    // while Soul Gateway's own proxy models have no namespace (copilot-*, kiro-*, etc.)
    const isNimModel = (name, descriptor) =>
        descriptor.providerKey === 'soul_gateway' && descriptor.fromGateway && name.includes('/');

    // Helper: check if a model name is wanted
    const isWanted = (name, descriptor) => {
        if (wantedSet) return wantedSet.has(name);
        return isNimModel(name, descriptor) || referenceSet.has(name);
    };

    // Pass 1: collect models that have a valid API key
    for (const [name, descriptor] of modelsConfig.models.entries()) {
        if (!isWanted(name, descriptor)) continue;

        const providerConfig = modelsConfig.providers.get(descriptor.providerKey);
        if (!providerConfig) continue;

        const apiKeyEnv = descriptor.apiKeyEnv || providerConfig.apiKeyEnv;
        const apiKey = apiKeyEnv ? process.env[apiKeyEnv] : null;
        if (!apiKey) continue;

        if (seen.has(name)) continue;
        seen.add(name);

        available.push({
            name,
            provider: descriptor.providerKey,
            mode: descriptor.mode || 'deep',
            apiKeyEnv,
            isReference: referenceSet.has(name),
        });
    }

    // Pass 2: for wanted models not yet found (e.g. static entry with missing API key
    // but available via soul_gateway discovery), check if soul_gateway can serve them.
    // Soul Gateway discovery skips models already in static config, so they won't be
    // in the models map under soul_gateway. We add them manually here.
    const soulGatewayProvider = modelsConfig.providers.get('soul_gateway');
    const soulGatewayKeyEnv = soulGatewayProvider?.apiKeyEnv;
    const soulGatewayKey = soulGatewayKeyEnv ? process.env[soulGatewayKeyEnv] : null;

    if (soulGatewayKey) {
        for (const [name, descriptor] of modelsConfig.models.entries()) {
            if (seen.has(name)) continue;
            if (!isWanted(name, descriptor)) continue;
            // Model exists but its provider key is missing — soul_gateway likely has it
            seen.add(name);
            available.push({
                name,
                provider: 'soul_gateway',
                mode: descriptor.mode || 'deep',
                apiKeyEnv: soulGatewayKeyEnv,
                isReference: referenceSet.has(name),
            });
        }
    }

    // Sort: reference models last so nvidia results come first
    available.sort((a, b) => {
        if (a.isReference !== b.isReference) return a.isReference ? 1 : -1;
        return a.name.localeCompare(b.name);
    });

    return available;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Strip HTML tags and truncate error messages (Cloudflare 524 pages, etc.) */
function cleanError(msg, maxLen = 150) {
    if (!msg) return msg;
    const cleaned = String(msg).replace(/<[^>]+>/g, ' ').replace(/\s{2,}/g, ' ').trim();
    return cleaned.length > maxLen ? cleaned.slice(0, maxLen) + '...' : cleaned;
}

async function cleanSkillDir(skillDir) {
    const srcDir = path.join(skillDir, 'src');
    const testsDir = path.join(skillDir, 'tests');
    const backupDir = path.join(skillDir, 'specs', '.backup');
    await fs.rm(srcDir, { recursive: true, force: true }).catch(() => {});
    await fs.rm(testsDir, { recursive: true, force: true }).catch(() => {});
    await fs.rm(backupDir, { recursive: true, force: true }).catch(() => {});
}

// ─────────────────────────────────────────────────────────────────────────────
// Test runner for a single model × skill
// ─────────────────────────────────────────────────────────────────────────────

async function testSkillForModel(modelName, skillName, skillDir) {
    const startTime = Date.now();
    const result = {
        skill: skillName,
        model: modelName,
        generated: false,
        syntaxOk: false,
        testsPassed: 0,
        testsFailed: 0,
        testsTotal: 0,
        testDetails: [],
        genTimeMs: 0,
        totalTimeMs: 0,
        error: null,
        filesGenerated: [],
    };

    // Create agent with model override + cache-busting nonce
    const llmAgent = new LLMAgent({ name: `NvCodeGen-${skillName}` });
    const origExecutePrompt = llmAgent.executePrompt.bind(llmAgent);
    llmAgent.executePrompt = function (prompt, opts = {}) {
        // Append nonce to bypass Soul Gateway prompt_hash cache
        const nonce = `\n<!-- [bench-${Date.now()}-${Math.random().toString(36).slice(2, 8)}] -->`;
        return origExecutePrompt(prompt + nonce, { ...opts, model: modelName });
    };

    const quietLogger = {
        log: () => {},
        warn: () => {},
        error: () => {},  // Suppress — errors are captured in result.error
    };

    try {
        // Step 1: Clean skill directory
        await cleanSkillDir(skillDir);

        // Step 2: Generate code from specs
        // Suppress [AchillesAgentsLib] cascade-fail warnings (HTML pages from timeouts)
        const origWarn = console.warn;
        console.warn = () => {};
        const genStart = Date.now();
        let generatedFiles;
        try {
            generatedFiles = await generateMirrorCode(skillDir, llmAgent, quietLogger);
        } finally {
            console.warn = origWarn;
        }
        result.genTimeMs = Date.now() - genStart;
        result.filesGenerated = generatedFiles || [];

        if (!generatedFiles || generatedFiles.length === 0) {
            result.error = 'No files generated';
            result.totalTimeMs = Date.now() - startTime;
            return result;
        }

        // Verify the file actually exists (generateMirrorCode deletes it on failed repair)
        const entryFile = path.join(skillDir, generatedFiles[0]);
        const fileExists = await fs.stat(entryFile).then(() => true).catch(() => false);
        if (!fileExists) {
            result.error = 'Generated file deleted (syntax repair failed)';
            result.totalTimeMs = Date.now() - startTime;
            return result;
        }
        result.generated = true;

        // Step 3: Syntax check
        try {
            await execFileAsync('node', ['--check', entryFile]);
            result.syntaxOk = true;
        } catch (syntaxError) {
            result.error = cleanError(`Syntax error: ${syntaxError.stderr || syntaxError.message || ''}`);
            result.totalTimeMs = Date.now() - startTime;
            return result;
        }

        // Step 4: Functional test suite (10 tests per skill)
        const testFn = SKILL_TESTS[skillName];
        if (testFn) {
            try {
                const fileUrl = pathToFileURL(entryFile).href + `?t=${Date.now()}`;
                const mod = await import(fileUrl);
                const action = mod.action || mod.default;
                if (typeof action !== 'function') {
                    result.error = `action export is ${typeof action}, not a function`;
                    result.totalTimeMs = Date.now() - startTime;
                    return result;
                }
                const suiteResult = await testFn(action);
                result.testsPassed = suiteResult.passed;
                result.testsFailed = suiteResult.failed;
                result.testsTotal = suiteResult.passed + suiteResult.failed;
                result.testDetails = suiteResult.results;
            } catch (testError) {
                result.error = cleanError(`Runtime error: ${testError.message || ''}`);
            }
        }
    } catch (error) {
        result.error = cleanError(`Generation error: ${error.message || ''}`);
    } finally {
        await cleanSkillDir(skillDir);
        result.totalTimeMs = Date.now() - startTime;
    }

    return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Output formatting
// ─────────────────────────────────────────────────────────────────────────────

function printModelResults(modelName, results, isReference = false) {
    const total = results.length;
    const avgGenTime = results.reduce((s, r) => s + r.genTimeMs, 0) / total;
    const totalTests = results.reduce((s, r) => s + r.testsTotal, 0);
    const totalPassed = results.reduce((s, r) => s + r.testsPassed, 0);
    const allSkillsFullPass = results.every(r => r.testsTotal > 0 && r.testsFailed === 0);

    const color = allSkillsFullPass ? COLORS.GREEN :
                  totalPassed >= totalTests * 0.5 ? COLORS.YELLOW : COLORS.RED;
    const refTag = isReference ? ` ${COLORS.YELLOW}(reference)${COLORS.RESET}` : '';

    console.log(`${color}${COLORS.BOLD}${modelName}${COLORS.RESET}${refTag}`);
    console.log(`  ${COLORS.CYAN}Tests:${COLORS.RESET} ${totalPassed}/${totalTests} passed across ${total} skills`);
    console.log(`  ${COLORS.CYAN}Avg Gen Time:${COLORS.RESET} ${avgGenTime.toFixed(0)}ms`);

    for (const r of results) {
        if (r.error) {
            console.log(`    ${COLORS.RED}ERROR${COLORS.RESET} ${r.skill} (${r.genTimeMs}ms) - ${r.error}`);
        } else if (!r.generated) {
            console.log(`    ${COLORS.RED}GEN FAIL${COLORS.RESET} ${r.skill} (${r.genTimeMs}ms)`);
        } else if (!r.syntaxOk) {
            console.log(`    ${COLORS.RED}SYNTAX${COLORS.RESET} ${r.skill} (${r.genTimeMs}ms)`);
        } else if (r.testsFailed === 0) {
            console.log(`    ${COLORS.GREEN}${r.testsPassed}/${r.testsTotal} PASS${COLORS.RESET} ${r.skill} (${r.genTimeMs}ms)`);
        } else {
            console.log(`    ${COLORS.YELLOW}${r.testsPassed}/${r.testsTotal} PASS${COLORS.RESET} ${r.skill} (${r.genTimeMs}ms)`);
            // Show failed tests
            for (const t of r.testDetails.filter(t => !t.pass)) {
                console.log(`      ${COLORS.RED}-${COLORS.RESET} ${t.name}${t.detail ? `: ${t.detail}` : ''}`);
            }
        }
    }
    console.log();
}

function printSummaryTable(allResults, skills, modelInfoMap) {
    console.log(`\n${COLORS.BOLD}${COLORS.CYAN}=== NVIDIA CODE GENERATION BENCHMARK SUMMARY ===${COLORS.RESET}\n`);

    const sorted = Object.entries(allResults)
        .map(([model, results]) => {
            const totalTests = results.reduce((s, r) => s + r.testsTotal, 0);
            const totalPassed = results.reduce((s, r) => s + r.testsPassed, 0);
            const syntaxOk = results.filter(r => r.syntaxOk).length;
            const total = results.length;
            const avgGenTime = results.reduce((s, r) => s + r.genTimeMs, 0) / total;
            const isReference = modelInfoMap.get(model)?.isReference || false;
            const testRate = totalTests > 0 ? totalPassed / totalTests : 0;
            return { model, testRate, totalPassed, totalTests, syntaxRate: syntaxOk / total, avgGenTime, total, isReference };
        })
        .sort((a, b) => {
            if (b.testRate !== a.testRate) return b.testRate - a.testRate;
            if (b.syntaxRate !== a.syntaxRate) return b.syntaxRate - a.syntaxRate;
            return a.avgGenTime - b.avgGenTime;
        });

    // Header
    const skillHeaders = skills.map(s => s.padStart(18)).join('');
    console.log(`${'Model'.padEnd(45)} ${'Tests'.padStart(10)} ${'Syntax'.padStart(8)} ${'AvgTime'.padStart(10)}${skillHeaders}`);
    console.log('-'.repeat(79 + skills.length * 18));

    for (const row of sorted) {
        const color = row.testRate === 1 ? COLORS.GREEN :
                      row.testRate >= 0.5 ? COLORS.YELLOW : COLORS.RED;

        const refLabel = row.isReference ? ' *' : '';
        let line = `${color}${(row.model + refLabel).padEnd(45)}${COLORS.RESET} `;
        line += `${`${row.totalPassed}/${row.totalTests}`.padStart(8)} `;
        line += `${(row.syntaxRate * 100).toFixed(0).padStart(6)}% `;
        line += `${row.avgGenTime.toFixed(0).padStart(8)}ms`;

        // Per-skill score
        const results = allResults[row.model];
        for (const skill of skills) {
            const r = results.find(x => x.skill === skill);
            if (!r) {
                line += '               N/A';
            } else if (r.error && !r.syntaxOk) {
                line += `${COLORS.RED}${'ERROR'.padStart(18)}${COLORS.RESET}`;
            } else if (!r.generated) {
                line += `${COLORS.RED}${'GEN FAIL'.padStart(18)}${COLORS.RESET}`;
            } else if (!r.syntaxOk) {
                line += `${COLORS.RED}${'SYNTAX ERR'.padStart(18)}${COLORS.RESET}`;
            } else {
                const score = `${r.testsPassed}/${r.testsTotal}`;
                const c = r.testsFailed === 0 ? COLORS.GREEN : r.testsPassed > 0 ? COLORS.YELLOW : COLORS.RED;
                line += `${c}${score.padStart(18)}${COLORS.RESET}`;
            }
        }

        console.log(line);
    }

    console.log('-'.repeat(79 + skills.length * 18));

    const hasRef = sorted.some(m => m.isReference);
    if (hasRef) {
        console.log(`${COLORS.GRAY}  * = reference model${COLORS.RESET}`);
    }

    // Recommendations (among nvidia models only)
    const nvidiaOnly = sorted.filter(m => !m.isReference);
    if (nvidiaOnly.length > 0) {
        const best = nvidiaOnly[0];
        const bestFast = [...nvidiaOnly]
            .filter(m => m.testRate >= 0.67)
            .sort((a, b) => a.avgGenTime - b.avgGenTime)[0];

        console.log(`\n${COLORS.BOLD}Recommendations (nvidia):${COLORS.RESET}`);
        console.log(`  ${COLORS.GREEN}Best Quality:${COLORS.RESET} ${best.model} (${best.totalPassed}/${best.totalTests} tests, ${best.avgGenTime.toFixed(0)}ms avg)`);
        if (bestFast && bestFast.model !== best.model) {
            console.log(`  ${COLORS.CYAN}Best Speed:${COLORS.RESET} ${bestFast.model} (${bestFast.totalPassed}/${bestFast.totalTests} tests, ${bestFast.avgGenTime.toFixed(0)}ms avg)`);
        }

        // Compare against reference
        const refModels = sorted.filter(m => m.isReference && m.testRate > 0);
        if (refModels.length > 0) {
            const ref = refModels[0];
            console.log(`  ${COLORS.YELLOW}Reference:${COLORS.RESET} ${ref.model} (${ref.totalPassed}/${ref.totalTests} tests, ${ref.avgGenTime.toFixed(0)}ms avg)`);
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
    const config = parseArgs();
    if (config.help) {
        printHelp();
        return;
    }

    console.log(`${COLORS.BOLD}${COLORS.CYAN}NVIDIA Code Generation Benchmark${COLORS.RESET}\n`);

    const modelsConfig = await loadModelsConfiguration();
    const availableModels = getModelsToTest(modelsConfig, config.models, config.includeReference);

    if (availableModels.length === 0) {
        console.log(`${COLORS.RED}No models available to test.${COLORS.RESET}`);
        console.log('Make sure SOUL_GATEWAY_API_KEY is set in environment.');
        console.log('\nAvailable NIM models:');
        for (const [name, descriptor] of modelsConfig.models.entries()) {
            const isNim = descriptor.providerKey === 'soul_gateway' && descriptor.fromGateway && name.includes('/');
            if (!isNim && !REFERENCE_MODELS.includes(name)) continue;
            const providerConfig = modelsConfig.providers.get(descriptor.providerKey);
            const apiKeyEnv = descriptor.apiKeyEnv || providerConfig?.apiKeyEnv || 'N/A';
            const hasKey = apiKeyEnv !== 'N/A' && process.env[apiKeyEnv] ? '✓' : '✗';
            console.log(`  ${hasKey} ${name} (${apiKeyEnv})`);
        }
        return;
    }

    // Validate skills
    const validSkills = config.skills.filter(s => SKILL_TESTS[s]);
    if (validSkills.length === 0) {
        console.log(`${COLORS.RED}No valid skills specified.${COLORS.RESET}`);
        console.log(`Available: ${Object.keys(SKILL_TESTS).join(', ')}`);
        return;
    }

    const nvidiaCount = availableModels.filter(m => !m.isReference).length;
    const refCount = availableModels.filter(m => m.isReference).length;
    console.log(`${COLORS.CYAN}Models:${COLORS.RESET} ${nvidiaCount} nvidia + ${refCount} reference`);
    availableModels.forEach(m => {
        const tag = m.isReference ? ` ${COLORS.YELLOW}(reference)${COLORS.RESET}` : '';
        console.log(`  - ${m.name}${tag}`);
    });
    console.log(`${COLORS.CYAN}Skills:${COLORS.RESET} ${validSkills.join(', ')}`);
    console.log(`${COLORS.CYAN}Total tests:${COLORS.RESET} ${availableModels.length * validSkills.length}`);
    if (config.cooldown > 0) {
        console.log(`${COLORS.CYAN}Cooldown:${COLORS.RESET} ${config.cooldown}ms between models`);
    }
    console.log();

    // Build model info lookup for reference tagging in output
    const modelInfoMap = new Map(availableModels.map(m => [m.name, m]));

    const allResults = {};
    const totalTests = availableModels.length * validSkills.length;
    let completedTests = 0;

    for (let mi = 0; mi < availableModels.length; mi++) {
        const model = availableModels[mi];
        allResults[model.name] = [];

        // Cooldown between models (skip first)
        if (mi > 0 && config.cooldown > 0) {
            process.stdout.write(`${COLORS.GRAY}  Cooldown ${config.cooldown}ms...${COLORS.RESET}\r`);
            await new Promise(r => setTimeout(r, config.cooldown));
        }

        for (const skillName of validSkills) {
            completedTests++;
            const pct = Math.round((completedTests / totalTests) * 100);
            process.stdout.write(`\r[${pct}%] ${model.name} | ${skillName}${''.padEnd(20)}`);

            const skillDir = path.join(MIRROR_SKILLS_DIR, skillName);
            const result = await testSkillForModel(model.name, skillName, skillDir);
            allResults[model.name].push(result);
        }
    }

    // Clear progress line
    process.stdout.write('\r' + ' '.repeat(80) + '\r');

    // Print detailed results sorted by performance
    console.log(`\n${COLORS.BOLD}${COLORS.CYAN}=== DETAILED RESULTS ===${COLORS.RESET}\n`);

    const sortedModels = Object.entries(allResults)
        .sort(([, a], [, b]) => {
            const aPass = a.filter(r => r.testPass).length;
            const bPass = b.filter(r => r.testPass).length;
            if (bPass !== aPass) return bPass - aPass;
            return a.reduce((s, r) => s + r.genTimeMs, 0) - b.reduce((s, r) => s + r.genTimeMs, 0);
        });

    for (const [model, results] of sortedModels) {
        const isRef = modelInfoMap.get(model)?.isReference || false;
        printModelResults(model, results, isRef);
    }

    // Print summary table
    printSummaryTable(allResults, validSkills, modelInfoMap);

    // Save to file
    if (config.outputFile) {
        const output = {
            timestamp: new Date().toISOString(),
            benchmarkType: 'nvidia-code-generation',
            config: {
                skills: validSkills,
                cooldown: config.cooldown,
            },
            models: availableModels,
            results: allResults,
        };
        await fs.writeFile(config.outputFile, JSON.stringify(output, null, 2));
        console.log(`\n${COLORS.GREEN}Results saved to ${config.outputFile}${COLORS.RESET}`);
    }
}

main().catch(err => {
    console.error(`${COLORS.RED}Fatal error:${COLORS.RESET}`, err);
    process.exit(1);
});
