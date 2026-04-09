#!/usr/bin/env node
/**
 * Verification script for the opencode benchmark.
 * Runs against a project directory that should contain:
 *   src/depgraph.mjs  — the CLI tool
 *   tests/a.mjs..e.mjs — test fixtures with a cycle (a->b->c->a)
 *
 * Exits 0 if all checks pass, 1 otherwise.
 * Outputs JSON with detailed results to stdout.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const projectDir = process.argv[2] || '.';
const depgraph = path.join(projectDir, 'src', 'depgraph.mjs');
const testsDir = path.join(projectDir, 'tests');

const results = {
    fileChecks: {},
    functionalChecks: {},
    passed: 0,
    failed: 0,
    total: 0,
};

function check(name, fn) {
    results.total++;
    try {
        fn();
        results.functionalChecks[name] = { passed: true };
        results.passed++;
    } catch (err) {
        results.functionalChecks[name] = { passed: false, error: String(err.message || err).slice(0, 300) };
        results.failed++;
    }
}

function run(args, expectFail = false) {
    try {
        const out = execFileSync('node', [depgraph, ...args], {
            cwd: projectDir,
            encoding: 'utf8',
            timeout: 10000,
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        if (expectFail) throw new Error('Expected non-zero exit but got success');
        return { stdout: out, stderr: '', code: 0 };
    } catch (err) {
        if (expectFail && err.status !== 0) {
            return { stdout: err.stdout || '', stderr: err.stderr || '', code: err.status };
        }
        if (!expectFail) throw err;
        return { stdout: err.stdout || '', stderr: err.stderr || '', code: err.status };
    }
}

// === File existence checks ===
const requiredFiles = [
    'src/depgraph.mjs',
    'tests/a.mjs', 'tests/b.mjs', 'tests/c.mjs', 'tests/d.mjs', 'tests/e.mjs',
];

for (const f of requiredFiles) {
    const exists = fs.existsSync(path.join(projectDir, f));
    results.fileChecks[f] = exists;
    results.total++;
    if (exists) results.passed++;
    else results.failed++;
}

// Only run functional checks if depgraph exists
if (fs.existsSync(depgraph)) {
    // === DOT output ===
    check('dot_output_has_digraph', () => {
        const { stdout } = run([testsDir]);
        if (!stdout.includes('digraph')) throw new Error('Missing digraph header');
    });

    check('dot_output_has_edges', () => {
        const { stdout } = run([testsDir]);
        if (!stdout.includes('->')) throw new Error('No edges found in DOT output');
    });

    check('dot_cycle_edges_colored_red', () => {
        const { stdout } = run([testsDir]);
        // The cycle is a->b->c->a, these edges should be red
        if (!stdout.includes('red')) throw new Error('No red-colored edges for cycle');
    });

    check('dot_non_cycle_edge_not_red', () => {
        const { stdout } = run([testsDir]);
        // e->a is not part of the cycle, shouldn't be red
        const lines = stdout.split('\n');
        const eToA = lines.find(l => /e\.mjs.*->.*a\.mjs/.test(l));
        if (eToA && eToA.includes('red')) throw new Error('e->a should not be colored red');
    });

    // === JSON output ===
    check('json_output_parses', () => {
        const { stdout } = run(['--json', testsDir]);
        JSON.parse(stdout);
    });

    check('json_has_correct_adjacency', () => {
        const { stdout } = run(['--json', testsDir]);
        const graph = JSON.parse(stdout);
        // Find the key for a.mjs (could be relative or absolute)
        const aKey = Object.keys(graph).find(k => k.endsWith('a.mjs'));
        if (!aKey) throw new Error('No a.mjs key in JSON output');
        const aDeps = graph[aKey];
        if (!Array.isArray(aDeps)) throw new Error('a.mjs deps is not an array');
        const hasB = aDeps.some(d => d.endsWith('b.mjs'));
        if (!hasB) throw new Error('a.mjs should depend on b.mjs');
    });

    check('json_d_has_no_deps', () => {
        const { stdout } = run(['--json', testsDir]);
        const graph = JSON.parse(stdout);
        const dKey = Object.keys(graph).find(k => k.endsWith('d.mjs'));
        if (!dKey) throw new Error('No d.mjs in JSON');
        if (graph[dKey].length !== 0) throw new Error('d.mjs should have no dependencies');
    });

    // === Cycles only ===
    check('cycles_only_has_cycle_edges', () => {
        const { stdout } = run(['--cycles-only', testsDir]);
        if (!stdout.includes('->')) throw new Error('No edges in cycles-only output');
        if (!stdout.includes('red')) throw new Error('Cycle edges should be red');
    });

    check('cycles_only_excludes_non_cycle', () => {
        const { stdout } = run(['--cycles-only', testsDir]);
        const lines = stdout.split('\n');
        const eToA = lines.find(l => /e\.mjs.*->.*a\.mjs/.test(l));
        if (eToA) throw new Error('e->a should be excluded from cycles-only');
    });

    // === Error handling ===
    check('missing_dir_error', () => {
        const { stderr, code } = run(['/nonexistent/path/xyz'], true);
        if (code === 0) throw new Error('Should exit non-zero for missing dir');
    });

    // === Model-written tests ===
    const modelTests = path.join(testsDir, 'run-tests.mjs');
    if (fs.existsSync(modelTests)) {
        check('model_tests_pass', () => {
            execFileSync('node', [modelTests], {
                cwd: projectDir,
                encoding: 'utf8',
                timeout: 15000,
            });
        });
    }
}

// Output results
const passRate = results.total > 0 ? (results.passed / results.total * 100).toFixed(0) : 0;
results.passRate = Number(passRate);
process.stdout.write(JSON.stringify(results, null, 2) + '\n');
process.exit(results.failed > 0 ? 1 : 0);
