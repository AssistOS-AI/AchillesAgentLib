import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { AchilesCLI } from '../../../cli/achile-cli.js';
import { LLMAgent } from '../../../LLMAgents/LLMAgent.mjs';

const TEMP_ROOT = path.join(process.cwd(), 'tests', '.tmp', 'achiles-cli');

const ensureDir = (target) => {
    fs.mkdirSync(target, { recursive: true });
};

const createWorkspace = (label) => {
    ensureDir(TEMP_ROOT);
    const dir = path.join(TEMP_ROOT, `${label}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    ensureDir(dir);
    ensureDir(path.join(dir, 'src'));
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: label, version: '1.0.0' }, null, 2));
    fs.writeFileSync(path.join(dir, 'src', 'index.mjs'), 'export const hello = () => "hi";\n');
    return dir;
};

const createOutputBuffer = () => {
    const buffer = [];
    return {
        buffer,
        write: (chunk) => buffer.push(String(chunk)),
    };
};

const createPlannerLLM = (planSteps = [], extraHandlers = {}) => new LLMAgent({
    invokerStrategy: async ({ context }) => {
        if (context?.intent === 'achiles-cli-plan') {
            return JSON.stringify(planSteps);
        }
        if (context?.intent && Object.prototype.hasOwnProperty.call(extraHandlers, context.intent)) {
            const handler = extraHandlers[context.intent];
            if (typeof handler === 'function') {
                return handler(context);
            }
            return handler;
        }
        return '[]';
    },
});

test('AchilesCLI bootstraps automatically and explains steps', { concurrency: false, timeout: 20_000 }, async () => {
    const workspace = createWorkspace('auto-bootstrap');
    const output = createOutputBuffer();
    const planSteps = [{ skill: 'mock-build', prompt: 'preview the specifications' }];
    const cli = new AchilesCLI({
        llmAgent: createPlannerLLM(planSteps),
        workspaceRoot: workspace,
        output,
    });

    const firstRun = await cli.processTaskInput('Generate a quick preview.');
    assert.equal(firstRun.executions.length, 1);
    assert.equal(firstRun.executions[0].status, 'ok');

    const autoRuns = output.buffer.filter((line) => line.includes('[auto] Running'));
    assert.equal(autoRuns.length, 2, 'Expected two bootstrap steps to run.');

    await cli.processTaskInput('Run again to ensure bootstrap is cached.');
    const autoRunsAfter = output.buffer.filter((line) => line.includes('[auto] Running'));
    assert.equal(autoRunsAfter.length, 2, 'Bootstrap should only run once per CLI instance.');

    const ignorePath = path.join(workspace, '.specs', '.ignore');
    assert.ok(fs.existsSync(ignorePath), 'Ignore file should exist after bootstrap.');
    const ignoreContent = fs.readFileSync(ignorePath, 'utf8');
    assert.ok(ignoreContent.includes('node_modules'), 'Default ignore entries must be present.');

    const dsDir = path.join(workspace, '.specs', 'DS');
    const dsFiles = fs.readdirSync(dsDir).filter((entry) => entry.endsWith('.md'));
    assert.ok(dsFiles.length >= 1, 'Bootstrap reverse-specs should capture at least one DS file.');
    const firstDs = fs.readFileSync(path.join(dsDir, dsFiles[0]), 'utf8');
    assert.match(firstDs, /src\/index\.mjs/, 'Bootstrap reverse-specs must document existing source files.');
});

test('AchilesCLI drives specs → build → mock → test lifecycle', { concurrency: false, timeout: 40_000 }, async () => {
    const workspace = createWorkspace('full-cycle');
    const output = createOutputBuffer();
    const planSteps = [
        { skill: 'update-specs', prompt: 'Document ingestion pipeline (FS-002).' },
        { skill: 'build-code', prompt: 'Generate files from DS-002 impacts.' },
        { skill: 'mock-build', prompt: 'Preview the CLI experience.' },
        { skill: 'run-tests', prompt: 'Execute FS-002 validations.' },
    ];
    const handlers = {
        'reverse-specs-plan': '[]',
        'update-specs-plan': () => JSON.stringify([
            { action: 'createURS', title: 'URS ingestion', description: 'Need ingestion pipeline.' },
            { action: 'createFS', title: 'FS ingestion', description: 'System ingests payloads.', ursId: 'URS-002' },
            { action: 'createDS', title: 'DS ingestion', description: 'Design ingestion module.', architecture: 'Stream records', ursId: 'URS-002', reqId: 'FS-002' },
            {
                action: 'describeFile',
                dsId: 'DS-002',
                filePath: 'src/ingest/pipeline.mjs',
                description: 'Implements ingestion controller.',
                why: 'Process inbound payloads from partners.',
                how: 'Applies validation and persistence before emitting events.',
                what: 'Exports runIngestion(options).',
                sideEffects: 'Writes audit metrics.',
                concurrency: 'Single threaded coordinator.',
            },
            { action: 'createTest', dsId: 'DS-002', title: 'Ingestion happy path', description: 'Execute FS-002 suite.' },
        ]),
        'build-code-generate': ({ filePath }) => {
            if (filePath.includes('ingest/pipeline.mjs')) {
                return 'export const runIngestion = () => ({ status: "mock" });';
            }
            return 'export const autogenerated = () => true;';
        },
    };
    const cli = new AchilesCLI({
        llmAgent: createPlannerLLM(planSteps, handlers),
        workspaceRoot: workspace,
        output,
    });
    const ignorePath = path.join(workspace, '.specs', '.ignore');
    fs.appendFileSync(ignorePath, '\npackage.json\n');

    const { plan, executions } = await cli.processTaskInput('Deliver ingestion pipeline ready for QA.');
    assert.equal(plan.length, planSteps.length, 'Plan should echo the LLM produced steps.');
    assert.equal(executions.length, planSteps.length, 'All planned skills should execute.');
    executions.forEach((execution) => assert.equal(execution.status, 'ok', `Skill ${execution.skill} should succeed.`));

    const mockFile = path.join(workspace, '.specs', 'mock', 'mock-cli.js');
    assert.ok(fs.existsSync(mockFile), 'Mock build output should exist.');
    const mockContents = fs.readFileSync(mockFile, 'utf8');
    assert.ok(mockContents.includes('FS-002'), 'Mock CLI should reference the FS requirement.');

    const pipelineFile = path.join(workspace, 'src', 'ingest', 'pipeline.mjs');
    assert.ok(fs.existsSync(pipelineFile), 'Build code must generate DS described files.');
    const pipelineContent = fs.readFileSync(pipelineFile, 'utf8');
    assert.match(pipelineContent, /Managed by DS-002/, 'Generated file should be stamped with DS ownership.');
    assert.match(pipelineContent, /runIngestion/, 'Generated file should include the mocked implementation.');

    const runnerPath = path.join(workspace, 'runAlltests.js');
    const suitePath = path.join(workspace, 'tests', 'FS-002', 'fs-002.test.mjs');
    assert.ok(fs.existsSync(runnerPath), 'runAlltests.js must be scaffolded.');
    assert.ok(fs.existsSync(suitePath), 'Suite-specific tests should be scaffolded.');

    const runTestsEnvelope = executions[3].result || {};
    const runTestsResult = runTestsEnvelope.result?.output || {};
    assert.equal(runTestsResult.suite, 'FS-002');
    assert.equal(runTestsResult.status, 'passed');
    assert.equal(runTestsResult.exitCode, 0);
});

test('AchilesCLI falls back to generic skill when no plan is provided', { concurrency: false, timeout: 20_000 }, async () => {
    const workspace = createWorkspace('generic-fallback');
    const output = createOutputBuffer();
    const planResponses = {
        'generic-skill-plan': JSON.stringify([
            { tool: 'rewrite-file', target: 'src/index.mjs' },
        ]),
        'generic-skill-rewrite': '```js\nexport const hello = () => "generic";\n```',
    };
    const llm = new LLMAgent({
        invokerStrategy: async ({ context }) => {
            if (context?.intent === 'achiles-cli-plan') {
                return '[]';
            }
            if (context?.intent && planResponses[context.intent]) {
                return planResponses[context.intent];
            }
            return '[]';
        },
    });

    const cli = new AchilesCLI({
        llmAgent: llm,
        workspaceRoot: workspace,
        output,
    });

    const { plan, executions } = await cli.processTaskInput('Update the greeting.');
    assert.equal(plan.length, 0, 'Planner returned no steps.');
    assert.equal(executions.length, 1, 'Generic skill should run once.');
    assert.equal(executions[0].skill, 'generic-skill');
    assert.equal(executions[0].status, 'ok');

    const rewritten = fs.readFileSync(path.join(workspace, 'src', 'index.mjs'), 'utf8');
    assert.ok(rewritten.includes('"generic"'), 'Generic skill should rewrite the file.');
});
