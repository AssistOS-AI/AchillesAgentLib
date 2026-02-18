#!/usr/bin/env node
/**
 * Deep Models Benchmark Evaluation Suite
 * 
 * Tests all configured deep LLM models for:
 * 1. Response quality and reasoning depth
 * 2. Correctness (skill/tool selection accuracy)
 * 3. Parameter extraction quality
 * 4. Semantic accuracy (enabled by default for deep models)
 * 
 * Deep models are expected to produce higher-quality responses at the cost
 * of higher latency and token usage. This benchmark focuses on correctness
 * and semantic accuracy rather than raw speed.
 * 
 * Usage:
 *   node evalsSuite/modelBenchmark/evalDeepModelsBenchmark.mjs [options]
 * 
 * Options:
 *   --models <list>    Comma-separated list of models to test (default: all available deep models)
 *   --cases <range>    Test case range, e.g., "1-5" or "3" (default: all)
 *   --runs <n>         Number of runs per model/case (default: 1)
 *   --output <file>    Save results to JSON file
 *   --skip-semantic    Skip semantic matching (faster, less accurate)
 *   --help             Show help
 */

// ============================================================================
// CONFIGURATION - Edit these values to customize benchmark behavior
// ============================================================================
const CONFIG = {
    // Default deep models to test when --models flag is not provided
    // Resolved from ACHILLES_ENABLED_DEEP_MODELS env var or all available deep models
    defaultModels: null,

    // Number of runs per model/case for averaging (overridden by --runs)
    defaultRuns: 1,

    // Semantic matching enabled by default for deep models (more thorough evaluation)
    // Deep models justify the extra cost of semantic comparison
    skipSemanticByDefault: false,

    // Timeout for individual model calls (milliseconds)
    // Higher than fast models since deep models take longer to respond
    modelTimeout: 120000,

    // Models to always exclude from benchmarks (e.g., extremely expensive models)
    excludeModels: [],

    // Difficulty levels to include (null = all)
    // Options: 'easy', 'medium', 'hard', 'very_hard'
    includeDifficulties: null,

    // Output formatting
    showDetailedResults: true,
    showProgressBar: true,

    // Save results automatically to this file (null = don't auto-save)
    autoSaveResults: null,

    // Use production prompt by default (buildDetectIntentsPrompt from LLMAgents)
    // Set to false to use a simpler benchmark-specific prompt
    useProductionPrompt: true,
};
// ============================================================================

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILLS_PATH = path.join(__dirname, 'skillsForBenchmark.json');
const CASES_DIR = path.join(__dirname, 'cases');

// Dynamically import after env config
const { LLMAgent } = await import('../../LLMAgents/LLMAgent.mjs');
const { loadModelsConfiguration } = await import('../../utils/LLMClient.mjs');
const { buildDetectIntentsPrompt } = await import('../../LLMAgents/templates/prompts.mjs');

const COLORS = {
    RESET: '\x1b[0m',
    RED: '\x1b[31m',
    GREEN: '\x1b[32m',
    YELLOW: '\x1b[33m',
    BLUE: '\x1b[34m',
    MAGENTA: '\x1b[35m',
    CYAN: '\x1b[36m',
    GRAY: '\x1b[90m',
    BOLD: '\x1b[1m',
};

/**
 * Resolve default models from configuration or environment variables.
 * Priority:
 * 1. CONFIG.defaultModels (if explicitly set as array)
 * 2. ACHILLES_ENABLED_DEEP_MODELS env var (comma-separated list)
 * 3. null (test all available deep models)
 * 
 * @returns {string[]|null} List of model names to test, or null for all models
 */
function resolveDefaultModels() {
    // If CONFIG has explicit models, use them
    if (Array.isArray(CONFIG.defaultModels) && CONFIG.defaultModels.length > 0) {
        return CONFIG.defaultModels;
    }

    // Check ACHILLES_ENABLED_DEEP_MODELS env var
    const envModels = process.env.ACHILLES_ENABLED_DEEP_MODELS;
    if (envModels && typeof envModels === 'string') {
        const models = envModels.split(',').map(m => m.trim()).filter(Boolean);
        if (models.length > 0) {
            console.log(`${COLORS.CYAN}Using models from ACHILLES_ENABLED_DEEP_MODELS:${COLORS.RESET} ${models.length} models`);
            return models;
        }
    }

    // Fall back to null (test all available deep models)
    return null;
}

function parseArgs() {
    const args = process.argv.slice(2);
    const options = {
        models: resolveDefaultModels(),
        caseRange: null,
        difficulties: null,
        runs: CONFIG.defaultRuns,
        outputFile: CONFIG.autoSaveResults,
        skipSemantic: CONFIG.skipSemanticByDefault,
        useProductionPrompt: CONFIG.useProductionPrompt,
        help: false,
    };

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--help' || arg === '-h') {
            options.help = true;
        } else if (arg === '--simple-prompt') {
            options.useProductionPrompt = false;
        } else if (arg === '--production-prompt') {
            options.useProductionPrompt = true;
        } else if (arg === '--models' || arg === '-m') {
            options.models = args[++i]?.split(',').map(m => m.trim()).filter(Boolean) || null;
        } else if (arg === '--all-models') {
            options.models = null; // Test all available deep models
        } else if (arg === '--cases' || arg === '-c') {
            options.caseRange = args[++i];
        } else if (arg === '--difficulty' || arg === '-d') {
            options.difficulties = args[++i]?.split(',').map(d => d.trim()).filter(Boolean) || null;
        } else if (arg === '--runs' || arg === '-r') {
            options.runs = parseInt(args[++i], 10) || 1;
        } else if (arg === '--output' || arg === '-o') {
            options.outputFile = args[++i];
        } else if (arg === '--skip-semantic') {
            options.skipSemantic = true;
        } else if (arg === '--with-semantic') {
            options.skipSemantic = false;
        }
    }

    return options;
}

function printHelp() {
    console.log(`
${COLORS.BOLD}Deep Models Benchmark Evaluation Suite${COLORS.RESET}

Tests all configured deep LLM models for quality and correctness.
Deep models are evaluated with semantic matching enabled by default.

${COLORS.CYAN}Usage:${COLORS.RESET}
  node evalsSuite/modelBenchmark/evalDeepModelsBenchmark.mjs [options]

${COLORS.CYAN}Options:${COLORS.RESET}
  --models, -m <list>   Comma-separated list of deep models to test
                        Example: --models "gpt-5.2,claude-opus-4-6"
                        Default: ${CONFIG.defaultModels?.join(', ') || 'from ACHILLES_ENABLED_DEEP_MODELS or all available'}
  --all-models          Test all available deep models (override default list)
  --cases, -c <range>   Test case range (e.g., "1-5" or "3")
  --difficulty, -d <l>  Filter by difficulty (e.g., "medium,hard")
  --runs, -r <n>        Number of runs per model/case (default: ${CONFIG.defaultRuns})
  --output, -o <file>   Save detailed results to JSON file
  --skip-semantic       Skip semantic matching (faster)
  --with-semantic       Enable semantic matching (default for deep models)
  --simple-prompt       Use simple benchmark prompt (not production)
  --production-prompt   Use production buildDetectIntentsPrompt (default)
  --help, -h            Show this help

${COLORS.CYAN}Current Configuration:${COLORS.RESET}
  Default models:       ${CONFIG.defaultModels?.join(', ') || 'from ACHILLES_ENABLED_DEEP_MODELS or all available'}
  Default runs:         ${CONFIG.defaultRuns}
  Skip semantic:        ${CONFIG.skipSemanticByDefault}
  Production prompt:    ${CONFIG.useProductionPrompt}
  Model timeout:        ${CONFIG.modelTimeout}ms

${COLORS.CYAN}Environment Variables:${COLORS.RESET}
  ACHILLES_ENABLED_DEEP_MODELS   Comma-separated list of deep models to test by default
                                 Example: "axiologic_proxy/gpt-5.3-codex,axiologic_proxy/gemini-2.5-pro"

${COLORS.CYAN}Examples:${COLORS.RESET}
  # Test models from ACHILLES_ENABLED_DEEP_MODELS env var (if set)
  node evalsSuite/modelBenchmark/evalDeepModelsBenchmark.mjs

  # Test all available deep models (ignore ACHILLES_ENABLED_DEEP_MODELS)
  node evalsSuite/modelBenchmark/evalDeepModelsBenchmark.mjs --all-models

  # Test specific deep models
  node evalsSuite/modelBenchmark/evalDeepModelsBenchmark.mjs --models "gpt-5.2,claude-opus-4-6"

  # Test with qualified names (provider/model)
  node evalsSuite/modelBenchmark/evalDeepModelsBenchmark.mjs --models "axiologic_proxy/gpt-5.3-codex,axiologic_proxy/gemini-2.5-pro"

  # Test only hard/very_hard cases (best for evaluating deep model strengths)
  node evalsSuite/modelBenchmark/evalDeepModelsBenchmark.mjs --difficulty "hard,very_hard"

  # Test with 3 runs per case for averaging
  node evalsSuite/modelBenchmark/evalDeepModelsBenchmark.mjs --runs 3

  # Save results to file
  node evalsSuite/modelBenchmark/evalDeepModelsBenchmark.mjs --output deep_results.json
`);
}

async function loadSkillsDescription() {
    const content = await fs.readFile(SKILLS_PATH, 'utf8');
    return JSON.parse(content);
}

async function loadTestCases(caseRange, difficulties = null) {
    const files = (await fs.readdir(CASES_DIR))
        .filter(f => f.endsWith('.json'))
        .sort();

    let filtered = files;
    if (caseRange) {
        const match = caseRange.match(/^(\d+)(?:-(\d+))?$/);
        if (match) {
            const start = parseInt(match[1], 10);
            const end = match[2] ? parseInt(match[2], 10) : start;
            filtered = files.filter(f => {
                const numMatch = f.match(/case_(\d+)/);
                if (numMatch) {
                    const num = parseInt(numMatch[1], 10);
                    return num >= start && num <= end;
                }
                return false;
            });
        }
    }

    const cases = [];
    for (const file of filtered) {
        const content = await fs.readFile(path.join(CASES_DIR, file), 'utf8');
        const parsed = JSON.parse(content);
        cases.push({ file, ...parsed });
    }

    // Filter by difficulty if specified
    if (difficulties && difficulties.length > 0) {
        return cases.filter(c => difficulties.includes(c.difficulty));
    }
    return cases;
}

/**
 * Get available deep models from configuration.
 * When no requestedModels are specified, filters to only deep-mode models.
 * 
 * @param {Object} modelsConfig - The loaded models configuration
 * @param {string[]|null} requestedModels - Explicitly requested model names
 * @returns {Array} - Available deep models with API keys
 */
function getAvailableModels(modelsConfig, requestedModels) {
    const available = [];
    
    for (const [name, descriptor] of modelsConfig.models.entries()) {
        // Skip excluded models
        if (CONFIG.excludeModels.includes(name)) continue;

        const providerConfig = modelsConfig.providers.get(descriptor.providerKey);
        if (!providerConfig) continue;

        // Check if API key is available
        const apiKeyEnv = descriptor.apiKeyEnv || providerConfig.apiKeyEnv;
        const apiKey = apiKeyEnv ? process.env[apiKeyEnv] : null;
        
        if (!apiKey) continue;

        // Build qualified name for matching (provider/model)
        const qualifiedName = `${descriptor.providerKey}/${name}`;
        
        // Filter by requested models if specified
        // Support both simple name and qualified name (provider/model)
        if (requestedModels) {
            const matchesSimple = requestedModels.includes(name);
            const matchesQualified = requestedModels.includes(qualifiedName);
            if (!matchesSimple && !matchesQualified) continue;
        } else {
            // When no models are explicitly requested, only include deep models
            if (descriptor.mode !== 'deep') continue;
        }

        // Use qualified name in output to support provider/model format
        const displayName = requestedModels?.includes(qualifiedName) ? qualifiedName : name;
        
        available.push({
            name: displayName,
            provider: descriptor.providerKey,
            mode: descriptor.mode || 'deep',
            apiKeyEnv,
        });
    }

    return available;
}

/**
 * Simple benchmark-specific prompt (for testing with --simple-prompt flag)
 */
function buildSimpleBenchmarkPrompt(skillsDescription, userPrompt) {
    return `You are an expert skill router. Given a user request, map it to the appropriate skills/tools.

Available Skills:
${JSON.stringify(skillsDescription, null, 2)}

User Request:
"${userPrompt}"

Instructions:
1. Identify which skills should be invoked to fulfill the request.
2. For each skill, provide a brief description of what it should do.
3. Return ONLY a JSON object where keys are skill names and values are action descriptions.

Example output:
{"calculate": "add 5 and 10", "notify": "send result to user"}

Respond ONLY with the JSON object, no explanation.`;
}

/**
 * Select the appropriate prompt builder based on configuration
 * @param {boolean} useProductionPrompt - Whether to use the production prompt
 * @returns {Function} - The prompt builder function
 */
function getPromptBuilder(useProductionPrompt) {
    if (useProductionPrompt) {
        // Use the actual production prompt from LLMAgents
        return buildDetectIntentsPrompt;
    } else {
        // Use simpler benchmark-specific prompt
        return buildSimpleBenchmarkPrompt;
    }
}

async function testModel(agent, modelName, skillsDescription, testCase, skipSemantic, promptBuilder) {
    const prompt = promptBuilder(skillsDescription, testCase.prompt);
    const startTime = Date.now();
    
    try {
        const response = await agent.complete({
            prompt,
            model: modelName,
            mode: 'deep',
            context: { intent: 'deep-benchmark-skill-selection' },
        });
        
        const endTime = Date.now();
        const latencyMs = endTime - startTime;

        // Parse response
        let parsed = null;
        try {
            // Try to extract JSON from response
            const jsonMatch = response.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                parsed = JSON.parse(jsonMatch[0]);
            }
        } catch {
            // Parse failed
        }

        if (!parsed) {
            return {
                success: false,
                latencyMs,
                error: 'Failed to parse JSON response',
                raw: response,
                expected: testCase.expected,
                actual: null,
            };
        }

        // Evaluate correctness
        const expectedKeys = new Set(Object.keys(testCase.expected));
        const actualKeys = new Set(Object.keys(parsed));
        
        let keyMatches = 0;
        let semanticMatches = 0;
        const details = [];

        for (const key of expectedKeys) {
            const inActual = actualKeys.has(key);
            if (inActual) {
                keyMatches++;
                
                // Semantic match check (enabled by default for deep models)
                if (!skipSemantic) {
                    const isSemanticMatch = await checkSemanticMatch(
                        agent, 
                        testCase.expected[key], 
                        parsed[key],
                    );
                    if (isSemanticMatch) {
                        semanticMatches++;
                        details.push({ key, status: 'match', expected: testCase.expected[key], actual: parsed[key] });
                    } else {
                        details.push({ key, status: 'semantic_mismatch', expected: testCase.expected[key], actual: parsed[key] });
                    }
                } else {
                    semanticMatches++;
                    details.push({ key, status: 'key_match', expected: testCase.expected[key], actual: parsed[key] });
                }
            } else {
                details.push({ key, status: 'missing', expected: testCase.expected[key], actual: null });
            }
        }

        // Check for unexpected keys
        for (const key of actualKeys) {
            if (!expectedKeys.has(key)) {
                details.push({ key, status: 'unexpected', expected: null, actual: parsed[key] });
            }
        }

        const keyAccuracy = expectedKeys.size > 0 ? keyMatches / expectedKeys.size : 0;
        const semanticAccuracy = expectedKeys.size > 0 ? semanticMatches / expectedKeys.size : 0;
        const success = keyAccuracy === 1 && semanticAccuracy === 1;

        return {
            success,
            latencyMs,
            keyAccuracy,
            semanticAccuracy,
            expected: testCase.expected,
            actual: parsed,
            details,
            error: null,
        };

    } catch (error) {
        return {
            success: false,
            latencyMs: Date.now() - startTime,
            error: error.message || String(error),
            expected: testCase.expected,
            actual: null,
        };
    }
}

async function checkSemanticMatch(agent, expected, actual) {
    if (!expected || !actual) return false;
    
    const expectedLower = String(expected).toLowerCase();
    const actualLower = String(actual).toLowerCase();
    
    // Quick exact match
    if (expectedLower === actualLower) return true;
    
    // Simple substring check for common cases
    const expectedWords = expectedLower.split(/\s+/).filter(w => w.length > 2);
    const matchingWords = expectedWords.filter(w => actualLower.includes(w));
    if (matchingWords.length >= expectedWords.length * 0.7) {
        return true;
    }

    // Use LLM for complex cases
    try {
        const prompt = `Compare these two task descriptions:
Expected: "${expected}"
Actual: "${actual}"

Do they describe essentially the same action? Answer ONLY "YES" or "NO".`;

        const response = await agent.complete({
            prompt,
            mode: 'deep',
            context: { intent: 'deep-benchmark-semantic-check' },
        });

        return response.trim().toUpperCase().includes('YES');
    } catch {
        return false;
    }
}

function printProgress(current, total, model, caseId) {
    const pct = Math.round((current / total) * 100);
    const bar = '='.repeat(Math.floor(pct / 5)) + ' '.repeat(20 - Math.floor(pct / 5));
    process.stdout.write(`\r[${bar}] ${pct}% | ${model} | ${caseId}     `);
}

function clearProgress() {
    process.stdout.write('\r' + ' '.repeat(80) + '\r');
}

function printModelResults(modelName, results) {
    const successful = results.filter(r => r.success).length;
    const total = results.length;
    const avgLatency = results.reduce((sum, r) => sum + r.latencyMs, 0) / total;
    const avgKeyAccuracy = results.reduce((sum, r) => sum + (r.keyAccuracy || 0), 0) / total;
    const avgSemanticAccuracy = results.reduce((sum, r) => sum + (r.semanticAccuracy || 0), 0) / total;
    const errorCount = results.filter(r => r.error).length;

    const color = successful === total ? COLORS.GREEN : 
                  successful >= total * 0.7 ? COLORS.YELLOW : COLORS.RED;

    console.log(`${color}${COLORS.BOLD}${modelName}${COLORS.RESET}`);
    console.log(`  ${COLORS.CYAN}Passed:${COLORS.RESET} ${successful}/${total} (${(successful/total*100).toFixed(1)}%)`);
    console.log(`  ${COLORS.CYAN}Avg Latency:${COLORS.RESET} ${avgLatency.toFixed(0)}ms`);
    console.log(`  ${COLORS.CYAN}Key Accuracy:${COLORS.RESET} ${(avgKeyAccuracy*100).toFixed(1)}%`);
    console.log(`  ${COLORS.CYAN}Semantic Accuracy:${COLORS.RESET} ${(avgSemanticAccuracy*100).toFixed(1)}%`);
    if (errorCount > 0) {
        console.log(`  ${COLORS.RED}Errors:${COLORS.RESET} ${errorCount}`);
    }
    console.log();
}

/**
 * Sort models by performance: highest accuracy first, then by latency if tied.
 * For deep models, accuracy is heavily prioritised over speed.
 * @param {Object} allResults - Results keyed by model name
 * @returns {string[]} - Model names in sorted order
 */
function sortModelsByPerformance(allResults) {
    return Object.entries(allResults)
        .map(([model, results]) => {
            const successful = results.filter(r => r.success).length;
            const total = results.length;
            const avgLatency = results.reduce((sum, r) => sum + r.latencyMs, 0) / total;
            const avgSemanticAcc = results.reduce((sum, r) => sum + (r.semanticAccuracy || 0), 0) / total;
            return {
                model,
                successRate: total > 0 ? successful / total : 0,
                avgSemanticAcc,
                avgLatency,
            };
        })
        .sort((a, b) => {
            // Sort by accuracy descending first
            if (b.successRate !== a.successRate) return b.successRate - a.successRate;
            // Then by semantic accuracy descending
            if (b.avgSemanticAcc !== a.avgSemanticAcc) return b.avgSemanticAcc - a.avgSemanticAcc;
            // If accuracy is the same, sort by latency ascending
            return a.avgLatency - b.avgLatency;
        })
        .map(item => item.model);
}

function printSummaryTable(allResults) {
    console.log(`\n${COLORS.BOLD}${COLORS.CYAN}=== DEEP MODELS BENCHMARK SUMMARY ===${COLORS.RESET}\n`);

    // Sort by success rate, then semantic accuracy, then by latency
    const sorted = Object.entries(allResults)
        .map(([model, results]) => {
            const successful = results.filter(r => r.success).length;
            const total = results.length;
            const avgLatency = results.reduce((sum, r) => sum + r.latencyMs, 0) / total;
            const avgKeyAcc = results.reduce((sum, r) => sum + (r.keyAccuracy || 0), 0) / total;
            const avgSemAcc = results.reduce((sum, r) => sum + (r.semanticAccuracy || 0), 0) / total;
            return {
                model,
                successRate: successful / total,
                avgLatency,
                avgKeyAcc,
                avgSemAcc,
                total,
                successful,
            };
        })
        .sort((a, b) => {
            if (b.successRate !== a.successRate) return b.successRate - a.successRate;
            if (b.avgSemAcc !== a.avgSemAcc) return b.avgSemAcc - a.avgSemAcc;
            return a.avgLatency - b.avgLatency;
        });

    // Print header
    console.log(`${'Model'.padEnd(45)} ${'Pass'.padStart(8)} ${'Latency'.padStart(10)} ${'KeyAcc'.padStart(8)} ${'SemAcc'.padStart(8)}`);
    console.log('-'.repeat(85));

    for (const row of sorted) {
        const color = row.successRate === 1 ? COLORS.GREEN :
                      row.successRate >= 0.7 ? COLORS.YELLOW : COLORS.RED;
        
        console.log(
            `${color}${row.model.padEnd(45)}${COLORS.RESET} ` +
            `${(row.successRate * 100).toFixed(0).padStart(6)}% ` +
            `${row.avgLatency.toFixed(0).padStart(8)}ms ` +
            `${(row.avgKeyAcc * 100).toFixed(0).padStart(6)}% ` +
            `${(row.avgSemAcc * 100).toFixed(0).padStart(6)}%`,
        );
    }

    console.log('-'.repeat(85));

    // Best model recommendation
    if (sorted.length > 0) {
        const best = sorted[0];
        const bestValue = [...sorted]
            .filter(m => m.successRate >= 0.9)
            .sort((a, b) => a.avgLatency - b.avgLatency)[0];
        
        console.log(`\n${COLORS.BOLD}Recommendations:${COLORS.RESET}`);
        console.log(`  ${COLORS.GREEN}Best Quality:${COLORS.RESET} ${best.model} (${(best.successRate*100).toFixed(0)}% accuracy, ${(best.avgSemAcc*100).toFixed(0)}% semantic, ${best.avgLatency.toFixed(0)}ms)`);
        if (bestValue && bestValue.model !== best.model) {
            console.log(`  ${COLORS.CYAN}Best Value:${COLORS.RESET} ${bestValue.model} (${(bestValue.successRate*100).toFixed(0)}% accuracy, ${bestValue.avgLatency.toFixed(0)}ms)`);
        }
    }
}

async function main() {
    const config = parseArgs();

    if (config.help) {
        printHelp();
        return;
    }

    console.log(`${COLORS.BOLD}${COLORS.CYAN}Deep Models Benchmark Evaluation Suite${COLORS.RESET}\n`);

    // Load configurations
    const modelsConfig = loadModelsConfiguration();
    const skillsDescription = await loadSkillsDescription();
    const testCases = await loadTestCases(config.caseRange, config.difficulties);
    const availableModels = getAvailableModels(modelsConfig, config.models);

    if (availableModels.length === 0) {
        console.log(`${COLORS.RED}No deep models available to test.${COLORS.RESET}`);
        console.log('Make sure API keys are set in environment variables.');
        console.log('\nConfigured deep models and their API key requirements:');
        for (const [name, descriptor] of modelsConfig.models.entries()) {
            if (descriptor.mode !== 'deep') continue;
            const providerConfig = modelsConfig.providers.get(descriptor.providerKey);
            const apiKeyEnv = descriptor.apiKeyEnv || providerConfig?.apiKeyEnv || 'N/A';
            const hasKey = apiKeyEnv !== 'N/A' && process.env[apiKeyEnv] ? '✓' : '✗';
            console.log(`  ${hasKey} ${name} (${apiKeyEnv})`);
        }
        return;
    }

    console.log(`${COLORS.CYAN}Deep models to test:${COLORS.RESET} ${availableModels.length}`);
    availableModels.forEach(m => console.log(`  - ${m.name} (${m.provider}, mode: ${m.mode})`));
    console.log(`${COLORS.CYAN}Test cases:${COLORS.RESET} ${testCases.length}`);
    console.log(`${COLORS.CYAN}Runs per case:${COLORS.RESET} ${config.runs}`);
    console.log(`${COLORS.CYAN}Semantic matching:${COLORS.RESET} ${config.skipSemantic ? 'disabled' : 'enabled (default for deep models)'}`);
    console.log(`${COLORS.CYAN}Prompt type:${COLORS.RESET} ${config.useProductionPrompt ? 'production (buildDetectIntentsPrompt)' : 'simple benchmark'}`);
    console.log(`${COLORS.CYAN}Model timeout:${COLORS.RESET} ${CONFIG.modelTimeout}ms`);
    console.log();

    const agent = new LLMAgent({ name: 'DeepModelBenchmark' });
    const promptBuilder = getPromptBuilder(config.useProductionPrompt);
    const allResults = {};
    const totalTests = availableModels.length * testCases.length * config.runs;
    let completedTests = 0;

    for (const modelInfo of availableModels) {
        allResults[modelInfo.name] = [];

        for (const testCase of testCases) {
            for (let run = 0; run < config.runs; run++) {
                completedTests++;
                printProgress(completedTests, totalTests, modelInfo.name, testCase.id);

                const result = await testModel(
                    agent,
                    modelInfo.name,
                    skillsDescription,
                    testCase,
                    config.skipSemantic,
                    promptBuilder,
                );

                allResults[modelInfo.name].push({
                    caseId: testCase.id,
                    run: run + 1,
                    difficulty: testCase.difficulty,
                    ...result,
                });
            }
        }
    }

    clearProgress();

    // Sort results by accuracy (desc) then latency (asc)
    const sortedModelNames = sortModelsByPerformance(allResults);

    // Print individual model results in sorted order
    console.log(`\n${COLORS.BOLD}${COLORS.CYAN}=== DETAILED RESULTS ===${COLORS.RESET}\n`);
    for (const model of sortedModelNames) {
        printModelResults(model, allResults[model]);
    }

    // Print summary table
    printSummaryTable(allResults);

    // Save to file if requested
    if (config.outputFile) {
        const output = {
            timestamp: new Date().toISOString(),
            benchmarkType: 'deep',
            config: {
                runs: config.runs,
                skipSemantic: config.skipSemantic,
                caseRange: config.caseRange,
                difficulties: config.difficulties,
                useProductionPrompt: config.useProductionPrompt,
                modelTimeout: CONFIG.modelTimeout,
            },
            models: availableModels,
            testCases: testCases.map(c => ({ id: c.id, difficulty: c.difficulty })),
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
