import fs from 'node:fs';
import path from 'node:path';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

import GampRSP from '../../../cli/achilles-cli/GampRSP.mjs';
import buildCode from '../../../cli/achilles-cli/.AchillesSkills/gamp/build-code/build-code.js';
import mockBuild from '../../../cli/achilles-cli/.AchillesSkills/gamp/mock-build/mock-build.js';
import reverseSpecs from '../../../cli/achilles-cli/.AchillesSkills/gamp/reverse-specs/reverse-specs.js';
import runTests from '../../../cli/achilles-cli/.AchillesSkills/gamp/run-tests/run-tests.js';
import fixTestsAndCode from '../../../cli/achilles-cli/.AchillesSkills/gamp/fix-tests-and-code/fix-tests-and-code.js';
import { LLMAgent } from '../../../LLMAgents/LLMAgent.mjs';

const TEMP_ROOT = path.join(process.cwd(), 'tests', '.tmp', 'workspace-workflows');

// Cleanup temp directories after all tests complete
after(() => {
    if (fs.existsSync(TEMP_ROOT)) {
        fs.rmSync(TEMP_ROOT, { recursive: true, force: true });
    }
});

const makeWorkspace = (label) => {
    fs.mkdirSync(TEMP_ROOT, { recursive: true });
    const dir = path.join(TEMP_ROOT, `${label}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
        name: label,
        version: '1.0.0',
        type: 'module',
    }, null, 2));
    return dir;
};

const createLLM = (handlers = {}) => new LLMAgent({
    invokerStrategy: async ({ context }) => {
        if (context?.intent && Object.prototype.hasOwnProperty.call(handlers, context.intent)) {
            const handler = handlers[context.intent];
            if (typeof handler === 'function') {
                return handler(context);
            }
            return handler;
        }
        return '[]';
    },
});

test('build-code synthesizes files using DS metadata + LLM output', { concurrency: false, timeout: 20_000 }, async () => {
    const workspaceRoot = makeWorkspace('build-llm');
    GampRSP.configure(workspaceRoot);
    const ursId = GampRSP.createURS('URS automation', 'Automate metrics export.');
    const fsId = GampRSP.createFS('FS metrics export', 'Expose metrics endpoint.', ursId);
    const dsId = GampRSP.createDS('DS metrics module', 'Design metrics emitter.', 'Service architecture TBD.', ursId, fsId);
    GampRSP.describeFile(
        dsId,
        'src/metrics/emitter.mjs',
        'Emit metrics to stdout.',
        ['createEmitter'],
        ['node:process'],
        {
            why: 'Provide quick observability for prototypes.',
            how: 'Wraps process.stdout writes.',
            what: 'Exports a createEmitter factory.',
            sideEffects: 'Writes to standard output.',
            concurrency: 'Stateless functional helper.',
        },
    );

    const llm = createLLM({
        'build-code-generate': ({ filePath }) => {
            if (filePath === 'src/metrics/emitter.mjs') {
                return 'export const createEmitter = () => ({ emit: (name) => `metric:${name}` });';
            }
            return 'export const placeholder = () => true;';
        },
    });

    const result = await buildCode({ context: { workspaceRoot, llmAgent: llm } });
    assert.ok(result.manifest.created.includes('src/metrics/emitter.mjs'), 'Expected emitter file creation.');

    const content = fs.readFileSync(path.join(workspaceRoot, 'src', 'metrics', 'emitter.mjs'), 'utf8');
    assert.match(content, /Managed by DS-001/, 'Content should include DS ownership banner.');
    assert.match(content, /createEmitter/, 'LLM generated function should be present.');
});

test('mock-build summarises specs and publishes HTML artefacts', { concurrency: false, timeout: 15_000 }, async () => {
    const workspaceRoot = makeWorkspace('mock-html');
    const pkgPath = path.join(workspaceRoot, 'package.json');
    fs.writeFileSync(pkgPath, JSON.stringify({
        name: 'web-project',
        version: '1.0.0',
        type: 'module',
        dependencies: {
            react: '^18.0.0',
        },
    }, null, 2));
    GampRSP.configure(workspaceRoot);
    const ursId = GampRSP.createURS('URS dashboard', 'Need KPI dashboard.');
    GampRSP.createFS('FS dashboard view', 'Render KPI tiles.', ursId);

    const result = await mockBuild({ context: { workspaceRoot } });
    assert.equal(result.type, 'spec-summary', 'Spec summary output should be reported.');
    assert.ok(fs.existsSync(result.output), 'Specification summary HTML must exist.');
    assert.ok(fs.existsSync(result.docsIndex), 'Generated documentation index should exist.');
    assert.ok(Array.isArray(result.specs.fs) && result.specs.fs.length >= 1, 'FS entries should appear in the summary payload.');
});

test('reverse-specs uses LLM plans per file to evolve specs', { concurrency: false, timeout: 20_000 }, async () => {
    const workspaceRoot = makeWorkspace('reverse-plan');
    const srcDir = path.join(workspaceRoot, 'src');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, 'app.mjs'), 'export const app = () => true;\n');
    fs.writeFileSync(path.join(srcDir, 'utils.mjs'), 'export const util = () => false;\n');
    GampRSP.configure(workspaceRoot);
    const handlers = {
        'reverse-specs-plan': ({ filePath }) => {
            if (filePath.endsWith('app.mjs')) {
                return JSON.stringify([
                    { action: 'createURS', title: 'URS core app', description: 'Document app entry.' },
                    { action: 'createFS', title: 'FS core app', description: 'Defines app behavior.', ursId: 'URS-001' },
                    { action: 'createDS', title: 'DS core app', description: 'Design core app.', architecture: 'Simple module', ursId: 'URS-001', reqId: 'FS-001' },
                    { action: 'describeFile', dsId: 'DS-001', filePath: 'src/app.mjs', description: 'App entry file.', why: 'Expose CLI handler.', how: 'Exports function app().', what: 'Primary entry point.' },
                ]);
            }
            return JSON.stringify([
                { action: 'describeFile', dsId: 'DS-001', filePath: 'src/utils.mjs', description: 'Utility helpers.', why: 'Support core app.', how: 'Exports util().', what: 'Helper functions.', sideEffects: 'None', concurrency: 'Stateless' },
            ]);
        },
    };
    const llm = createLLM(handlers);

    const outcome = await reverseSpecs({ prompt: 'Reverse engineer workspace.', context: { workspaceRoot, llmAgent: llm } });
    assert.ok(outcome.results.length >= 2, 'Should process at least the source files.');
    const dsDoc = fs.readFileSync(GampRSP.getDSFilePath('DS-001'), 'utf8');
    assert.match(dsDoc, /src\/app\.mjs/, 'DS document should include app file.');
    assert.match(dsDoc, /src\/utils\.mjs/, 'DS document should include utils file.');
});

test('run-tests orchestrator executes scaffolded FS suites', { concurrency: false, timeout: 25_000 }, async () => {
    const workspaceRoot = makeWorkspace('run-tests');
    GampRSP.configure(workspaceRoot);
    const ursId = GampRSP.createURS('URS validation', 'Need FS suite.');
    const fsId = GampRSP.createFS('FS validation', 'Validations go here.', ursId);
    const dsId = GampRSP.createDS('DS validation', 'Design validation module.', 'Architecture TBD.', ursId, fsId);
    GampRSP.describeFile(dsId, 'src/validation/index.mjs', 'Validation stub.', ['validate'], [], {});

    await buildCode({ context: { workspaceRoot } });

    const outcome = await runTests({ prompt: fsId, context: { workspaceRoot } });
    assert.equal(outcome.status, 'passed');
    assert.equal(outcome.exitCode, 0);
    assert.equal(outcome.suite, fsId);
});

test('fix-tests-and-code retries until runAlltests succeeds', { concurrency: false, timeout: 25_000 }, async () => {
    const workspaceRoot = makeWorkspace('fix-tests');
    GampRSP.configure(workspaceRoot);

    const scriptPath = path.join(workspaceRoot, 'runAlltests.js');
    const script = `#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const marker = path.join(process.cwd(), '.specs', '.fix-attempt.json');
let attempts = 0;
if (fs.existsSync(marker)) {
    const payload = JSON.parse(fs.readFileSync(marker, 'utf8'));
    attempts = payload.attempts || 0;
}
attempts += 1;
fs.mkdirSync(path.dirname(marker), { recursive: true });
fs.writeFileSync(marker, JSON.stringify({ attempts }, null, 2));
if (attempts < 2) {
    console.error('Simulated failure');
    process.exit(1);
}
console.log('Simulated success');
process.exit(0);
`;
    fs.writeFileSync(scriptPath, script);

    const result = await fixTestsAndCode({ prompt: 'Stabilise suite', context: { workspaceRoot } });
    assert.equal(result.message, 'All tests passed.');
    assert.equal(result.attempts.length, 2, 'Should retry once before succeeding.');
    assert.equal(result.attempts[1].exitCode, 0, 'Final attempt should pass.');
});
