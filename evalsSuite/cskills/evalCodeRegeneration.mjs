/**
 * Eval: Code regeneration via mirror-code-generator.
 *
 * Tests the complete lifecycle of cskill code generation and regeneration
 * using the format-user skill fixture from evalsSuite/cskills/skills/.
 *
 * Follows the test plan from evalsSuite/cskills/README.md:
 *   1. Initial Code Generation
 *   2. No Regeneration When Specs Unchanged
 *   3. Regeneration When Specs Change
 *   4. Execution with Regenerated Code
 *   5. Cleanup
 *
 * Requires an LLM API key (any provider).
 * Run: node evalsSuite/cskills/evalCodeRegeneration.mjs
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, writeFile, rm, stat, mkdir, cp } from 'node:fs/promises';

import { MainAgent } from '../../MainAgent/index.mjs';
import { LLMAgent } from '../../LLMAgents/index.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, 'skills');

const COLORS = {
    RESET: '\x1b[0m',
    RED: '\x1b[31m',
    GREEN: '\x1b[32m',
    CYAN: '\x1b[36m',
    BOLD: '\x1b[1m',
};

let passed = 0;
let failed = 0;

function ok(condition, message) {
    if (condition) {
        console.log(`  ${COLORS.GREEN}✓${COLORS.RESET} ${message}`);
        passed += 1;
        return;
    }
    console.log(`  ${COLORS.RED}✗${COLORS.RESET} ${message}`);
    failed += 1;
}

async function fileExists(p) {
    try { await stat(p); return true; } catch { return false; }
}

async function setupWorkDir() {
    const workDir = path.join(__dirname, 'work');
    await rm(workDir, { recursive: true, force: true });
    await mkdir(path.join(workDir, 'skills'), { recursive: true });
    await cp(FIXTURES_DIR, path.join(workDir, 'skills'), { recursive: true });
    const skillDir = path.join(workDir, 'skills', 'format-user');
    const indexFile = path.join(skillDir, 'src', 'index.js');
    const newSpecFile = path.join(skillDir, 'specs', 'new-module.js.md');
    const newModuleFile = path.join(skillDir, 'src', 'new-module.js');
    return { workDir, skillDir, indexFile, newSpecFile, newModuleFile };
}

async function runEval() {
    console.log(`${COLORS.BOLD}${COLORS.CYAN}=== Code Regeneration Eval ===${COLORS.RESET}\n`);

    const llmAgent = new LLMAgent();
    try {
        await llmAgent.executePrompt('Return OK', { tier: 'fast' });
    } catch (error) {
        const attempts = Array.isArray(error?.attempts) ? error.attempts : [];
        const onlyMissingKeys = attempts.length > 0 && attempts.every((a) =>
            String(a?.error?.message || a?.error || '').toLowerCase().includes('missing api key')
        );
        console.log(`${COLORS.RED}LLM unavailable: ${onlyMissingKeys ? 'No API key found' : error.message}${COLORS.RESET}`);
        process.exit(0);
    }

    const { workDir, skillDir, indexFile, newSpecFile, newModuleFile } = await setupWorkDir();

    try {
        // ── Test 1: Initial Code Generation ──────────────────────────────
        console.log(`\n${COLORS.BOLD}Test 1: Initial Code Generation${COLORS.RESET}`);

        ok(await fileExists(path.join(skillDir, 'cskill.md')), 'cskill.md exists');
        ok(await fileExists(path.join(skillDir, 'specs', 'index.js.md')), 'specs/index.js.md exists');
        ok(!(await fileExists(indexFile)), 'src/index.js does NOT exist yet (will be generated)');

        const agent1 = new MainAgent({ startDir: workDir });
        const result1 = await agent1.executeSkill('format-user', 'Format user data for Jane Doe, age 25');

        ok(result1, 'execution returned a result');
        ok(await fileExists(indexFile), 'src/index.js was generated after execution');

        const initialCode = await readFile(indexFile, 'utf-8');
        ok(initialCode.includes('action'), 'generated code exports action function');
        ok(initialCode.includes('Full Name') || initialCode.includes('format'), 'generated code contains expected logic');
        ok(!initialCode.includes('newModuleFunction'), 'initial code does NOT contain new module function');

        // ── Test 2: No Regeneration When Specs Unchanged ─────────────────
        console.log(`\n${COLORS.BOLD}Test 2: No Regeneration When Specs Unchanged${COLORS.RESET}`);

        const codeBefore = await readFile(indexFile, 'utf-8');
        const agent2 = new MainAgent({ startDir: workDir });
        await agent2.executeSkill('format-user', 'Format user data for John Smith, age 30');
        const codeAfter = await readFile(indexFile, 'utf-8');

        ok(codeBefore === codeAfter, 'code was NOT regenerated (specs unchanged)');

        // ── Test 3: Regeneration When Specs Change ───────────────────────
        console.log(`\n${COLORS.BOLD}Test 3: Regeneration When Specs Change${COLORS.RESET}`);

        await writeFile(newSpecFile, `# Specification for new-module.js

## Function: newModuleFunction()

### Description
A new module function for testing regeneration.

### Returns
- string: "New module is working!"
`);

        // Delete generated code to force regeneration with new spec
        await rm(indexFile, { force: true });

        const agent3 = new MainAgent({ startDir: workDir });
        await agent3.executeSkill('format-user', 'Format user data for Alice Brown, age 17');

        ok(await fileExists(indexFile), 'src/index.js was regenerated after spec change + code deletion');
        ok(await fileExists(newModuleFile), 'src/new-module.js was created after spec change');

        const regeneratedCode = await readFile(newModuleFile, 'utf-8');
        ok(regeneratedCode.includes('newModuleFunction'), 'regenerated code includes new module function');

        // ── Test 4: Execution with Regenerated Code ──────────────────────
        console.log(`\n${COLORS.BOLD}Test 4: Execution with Regenerated Code${COLORS.RESET}`);

        const agent4 = new MainAgent({ startDir: workDir });
        const result4 = await agent4.executeSkill('format-user', 'Format user data for Bob Wilson, age 42');

        ok(result4, 'execution succeeded with regenerated code');
        ok(typeof result4.result === 'string', 'result is a string');

        // ── Test 5: Cleanup ──────────────────────────────────────────────
        console.log(`\n${COLORS.BOLD}Test 5: Cleanup${COLORS.RESET}`);

    } finally {
        await rm(workDir, { recursive: true, force: true });
    }

    console.log(`\n${COLORS.BOLD}${COLORS.CYAN}════════════════════════════════════${COLORS.RESET}`);
    console.log(`  ${COLORS.GREEN}Passed: ${passed}${COLORS.RESET}`);
    if (failed > 0) {
        console.log(`  ${COLORS.RED}Failed: ${failed}${COLORS.RESET}`);
    }
    console.log(`${COLORS.BOLD}${COLORS.CYAN}════════════════════════════════════${COLORS.RESET}`);

    process.exit(failed > 0 ? 1 : 0);
}

runEval();
