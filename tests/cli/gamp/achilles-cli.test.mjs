import fs from 'node:fs';
import path from 'node:path';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

import { AchillesCLI } from '../../../cli/achilles-cli/achilles-cli.mjs';
import { LLMAgent } from '../../../LLMAgents/LLMAgent.mjs';
import { resetLLMLogger, logLLMInteraction } from '../../../utils/LLMLogger.mjs';
import { withRawModePaused } from '../../../cli/achilles-cli/helpers/inputHelpers.mjs';
import { PLAN_INTENT } from '../../../cli/achilles-cli/intentionToSkill.mjs';
import { formatExecutionResult } from '../../../cli/achilles-cli/helpers/executionHelpers.mjs';

const TEMP_ROOT = path.join(process.cwd(), 'tests', '.tmp', 'achilles-cli');

// Cleanup temp directories after all tests complete
after(() => {
    if (fs.existsSync(TEMP_ROOT)) {
        fs.rmSync(TEMP_ROOT, { recursive: true, force: true });
    }
});

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
        if (context?.intent === PLAN_INTENT) {
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

const unwrapExecution = (execution) => {
    let current = execution?.result;
    if (!current || typeof current !== 'object') {
        return execution?.result || execution;
    }
    while (current && typeof current === 'object') {
        if (current.result && typeof current.result === 'object') {
            current = current.result;
            continue;
        }
        if (current.output && typeof current.output === 'object') {
            current = current.output;
            continue;
        }
        break;
    }
    return current || execution;
};

test('AchillesCLI bootstraps automatically and explains steps', { concurrency: false, timeout: 20_000 }, async () => {
    const workspace = createWorkspace('auto-bootstrap');
    const output = createOutputBuffer();
    const planSteps = [{ skill: 'mock-build', prompt: 'preview the specifications' }];
    const cli = new AchillesCLI({
        llmAgent: createPlannerLLM(planSteps),
        workspaceRoot: workspace,
        output,
    });

    const firstRun = await cli.processTaskInput('Generate a quick preview.');
    assert.equal(firstRun.executions.length, 1);
    assert.equal(firstRun.executions[0].status, 'ok');

    const autoRuns = output.buffer.filter((line) => line.includes('[auto] Running'));
    assert.equal(autoRuns.length, 1, 'Only the ignore-files bootstrap should run automatically.');

    await cli.processTaskInput('Run again to ensure bootstrap is cached.');
    const autoRunsAfter = output.buffer.filter((line) => line.includes('[auto] Running'));
    assert.equal(autoRunsAfter.length, 1, 'Bootstrap should only run once per CLI instance.');

    const ignorePath = path.join(workspace, '.specs', '.ignore');
    assert.ok(fs.existsSync(ignorePath), 'Ignore file should exist after bootstrap.');
    const ignoreContent = fs.readFileSync(ignorePath, 'utf8');
    assert.ok(ignoreContent.includes('node_modules'), 'Default ignore entries must be present.');
    const autoReverseMentions = output.buffer.filter((line) => line.includes('reverse-specs'));
    assert.equal(autoReverseMentions.length, 0, 'Reverse specs should not trigger automatically.');
});

test('AchillesCLI focuses on specs before code generation', { concurrency: false, timeout: 25_000 }, async () => {
    const workspace = createWorkspace('full-cycle');
    const output = createOutputBuffer();
    const planSteps = [
        { skill: 'update-specs', prompt: 'Document ingestion pipeline (FS-002).' },
        { skill: 'mock-build', prompt: 'Preview the specification set.' },
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
    };
    const cli = new AchillesCLI({
        llmAgent: createPlannerLLM(planSteps, handlers),
        workspaceRoot: workspace,
        output,
    });
    const ignorePath = path.join(workspace, '.specs', '.ignore');
    fs.appendFileSync(ignorePath, '\npackage.json\n');

    const { plan, executions } = await cli.processTaskInput('Document ingestion pipeline ready for QA (specs only).');
    assert.equal(plan.length, planSteps.length, 'Plan should echo the LLM produced steps.');
    assert.equal(executions.length, planSteps.length, 'All planned skills should execute.');
    executions.forEach((execution) => assert.equal(execution.status, 'ok', `Skill ${execution.skill} should succeed.`));

    const specSummaryResult = unwrapExecution(executions[1]);
    const specSummary = specSummaryResult.specs || {};
    assert.ok(Array.isArray(specSummary.fs), 'FS summary should exist.');
    assert.ok(Array.isArray(specSummary.fs) && specSummary.fs.length >= 1, 'FS summary should contain entries.');

    const summaryHtml = specSummaryResult.output;
    assert.ok(fs.existsSync(summaryHtml), 'Specification summary HTML should exist.');
    const docsIndex = specSummaryResult.docsIndex;
    assert.ok(fs.existsSync(docsIndex), 'Full HTML docs index should be generated.');
});

test('AchillesCLI surfaces planner failures when no plan can be produced', { concurrency: false, timeout: 20_000 }, async () => {
    const workspace = createWorkspace('generic-fallback');
    const llm = new LLMAgent({
        invokerStrategy: async ({ context }) => {
            if (context?.intent === PLAN_INTENT) {
                return '[]';
            }
            return '[]';
        },
    });

    const cli = new AchillesCLI({
        llmAgent: llm,
        workspaceRoot: workspace,
    });

    await assert.rejects(
        async () => cli.processTaskInput('Update the greeting.'),
        /Planner did not produce any steps/i,
    );
});

test('AchillesCLI enforces the default English language contract', { concurrency: false, timeout: 10_000 }, async () => {
    const workspace = createWorkspace('language-contract');
    const output = createOutputBuffer();
    const planPrompts = [];
    const llm = new LLMAgent({
        invokerStrategy: async ({ context, prompt }) => {
            if (context?.intent === PLAN_INTENT) {
                planPrompts.push(prompt);
                return JSON.stringify([{ skill: 'mock-build', prompt: 'Preview specifications.' }]);
            }
            return '[]';
        },
    });
    const cli = new AchillesCLI({
        llmAgent: llm,
        workspaceRoot: workspace,
        output,
        autoBootstrapMode: 'manual',
    });
    const executed = [];
    cli.recursiveAgent.executeWithReviewMode = async (promptText, options = {}) => {
        executed.push({ promptText, context: options?.context });
        return { result: { message: 'ok' } };
    };

    await cli.processTaskInput('Redactează specificațiile pentru demo.');

    assert.ok(planPrompts.length >= 1, 'Planner should receive at least one prompt.');
    assert.match(planPrompts[0], /Language Requirements/i, 'Plan prompt should include language contract.');
    assert.match(planPrompts[0], /english/i, 'Default language should be english.');
    assert.ok(executed.length >= 1, 'At least one skill execution should occur.');
    assert.match(executed[0].promptText, /Language Contract/i, 'Skill prompt should include language contract.');
    assert.match(executed[0].promptText, /english/i, 'Skill prompt should reference english output.');
    assert.equal(executed[0].context?.specLanguage, 'english', 'Context should expose the active spec language.');
    assert.match(executed[0].context?.languageContract || '', /Language Contract/i, 'Context should include the language contract text.');
});

test('AchillesCLI honors updated /lang preference for future prompts', { concurrency: false, timeout: 10_000 }, async () => {
    const workspace = createWorkspace('language-command');
    const output = createOutputBuffer();
    const planPrompts = [];
    const llm = new LLMAgent({
        invokerStrategy: async ({ context, prompt }) => {
            if (context?.intent === PLAN_INTENT) {
                planPrompts.push(prompt);
                return JSON.stringify([{ skill: 'mock-build', prompt: 'Preview specifications.' }]);
            }
            return '[]';
        },
    });
    const cli = new AchillesCLI({
        llmAgent: llm,
        workspaceRoot: workspace,
        output,
        autoBootstrapMode: 'manual',
    });
    cli.setSpecLanguage('romanian');

    const executed = [];
    cli.recursiveAgent.executeWithReviewMode = async (promptText, options = {}) => {
        executed.push({ promptText, context: options?.context });
        return { result: { message: 'ok' } };
    };

    await cli.processTaskInput('Documentează cerințele.');

    assert.ok(planPrompts.length >= 1, 'Planner should receive at least one prompt.');
    assert.match(planPrompts[0], /romanian/i, 'Plan prompt should mention the updated language.');
    assert.ok(executed.length >= 1, 'At least one skill execution should occur.');
    assert.match(executed[0].promptText, /romanian/i, 'Skill prompt should embed the updated language.');
    assert.equal(executed[0].context?.specLanguage, 'romanian', 'Context should expose the new language preference.');
});

test('AchillesCLI pauses the global key handler while collecting input', { concurrency: false, timeout: 10_000 }, async () => {
    const workspace = createWorkspace('language-raw-mode');
    const output = createOutputBuffer();
    const cli = new AchillesCLI({
        llmAgent: createPlannerLLM([]),
        workspaceRoot: workspace,
        output,
        autoBootstrapMode: 'manual',
        interactive: false,
    });
    const events = [];
    cli.inputStream = {
        off(event, handler) {
            events.push({ type: 'off', event, handler });
        },
        on(event, handler) {
            events.push({ type: 'on', event, handler });
        },
        setRawMode() {
            throw new Error('setRawMode should not be called while prompting');
        },
    };
    cli._handleKeypressBound = () => {};
    cli._keypressHandlerInitialized = true;
    let called = false;
    await withRawModePaused(cli, async () => {
        called = true;
    });
    assert.equal(called, true);
    assert.deepEqual(events.map((entry) => entry.type), ['off', 'on'], 'Key handler should detach during prompt collection.');
    assert.equal(events[0].event, 'keypress');
    assert.equal(events[1].event, 'keypress');
});

test('AchillesCLI reports the current language when /lang is invoked without arguments', { concurrency: false, timeout: 10_000 }, async () => {
    const workspace = createWorkspace('language-info');
    const output = createOutputBuffer();
    const cli = new AchillesCLI({
        llmAgent: createPlannerLLM([]),
        workspaceRoot: workspace,
        output,
        autoBootstrapMode: 'manual',
        interactive: false,
    });
    const inputs = ['/lang', '/exit'];
    cli.promptReader = async () => inputs.shift() || '/exit';
    await cli.runInteractive();
    const printed = output.buffer.join('');
    assert.match(printed, /Current specification language/i, 'CLI should describe the active specification language.');
});

test('AchillesCLI routes spec summary requests through the planner', { concurrency: false, timeout: 10_000 }, async () => {
    const workspace = createWorkspace('spec-summary-plan');
    const planSteps = [
        { skill: 'mock-build', prompt: 'Summarise current specifications.' },
    ];
    const cli = new AchillesCLI({
        llmAgent: createPlannerLLM(planSteps),
        workspaceRoot: workspace,
        autoBootstrapMode: 'manual',
    });
    const executed = [];
    cli.recursiveAgent.executeWithReviewMode = async (promptText, options = {}) => {
        executed.push({ promptText, options });
        return {
            message: 'Spec summary ready.',
            specs: {
                urs: [{ id: 'URS-001', title: 'Demo requirement', description: 'Demo description.' }],
                fs: [],
                nfs: [],
                ds: [],
            },
            output: path.join(workspace, '.specs', 'mock', 'spec-summary.html'),
            docsIndex: path.join(workspace, '.specs', 'html_docs', 'index.html'),
        };
    };

    const { plan, executions } = await cli.processTaskInput('afiseaza-mi specificatiile');
    assert.equal(plan.length, planSteps.length);
    const resolvedPlanSkill = cli.findSkill(plan[0]?.skill)?.name ?? plan[0]?.skill;
    assert.equal(executed[0]?.options?.skillName, resolvedPlanSkill, 'Planner-selected skill should execute.');
    assert.equal(executions.length, planSteps.length);
    const summary = unwrapExecution(executions[0])?.specs || {};
    assert.equal(summary.urs?.[0]?.id, 'URS-001');
});

test('AchillesCLI prints spec action previews during execution', { concurrency: false, timeout: 10_000 }, async () => {
    const workspace = createWorkspace('spec-action-preview');
    const planSteps = [
        { skill: 'update-specs', prompt: 'Update demo specs.' },
    ];
    const output = createOutputBuffer();
    const cli = new AchillesCLI({
        llmAgent: createPlannerLLM(planSteps),
        workspaceRoot: workspace,
        autoBootstrapMode: 'manual',
        output,
    });
    cli.recursiveAgent.executeWithReviewMode = async () => ({
        result: {
            message: 'Specs updated.',
            actions: [
                { action: 'createURS', id: 'URS-010', title: 'Demo URS' },
                { action: 'createFS', id: 'FS-010', title: 'Demo FS' },
                { action: 'describeFile', id: 'DS-010', filePath: 'src/demo.mjs' },
            ],
        },
    });

    const execution = await cli.processTaskInput('creeaza specificatiile demo');
    const specLines = output.buffer.filter((line) => line.includes('[spec] update-specs'));
    assert.equal(specLines.length, 1, 'Spec action preview should run once per skill execution.');
    const summaryLines = formatExecutionResult(cli, execution.executions[0]);
    assert.ok(summaryLines.some((line) => /spec actions:/i.test(line)), 'Execution summary should include spec actions.');
});

test('AchillesCLI surfaces planner failures when no steps are returned', { concurrency: false, timeout: 10_000 }, async () => {
    const workspace = createWorkspace('spec-heuristic');
    const llm = new LLMAgent({
        invokerStrategy: async ({ context }) => {
            if (context?.intent === PLAN_INTENT) {
                return '[]';
            }
            return '[]';
        },
    });
    const cli = new AchillesCLI({
        llmAgent: llm,
        workspaceRoot: workspace,
        autoBootstrapMode: 'manual',
        interactive: false,
    });

    await assert.rejects(
        async () => cli.processTaskInput('fa-mi specificatiile complete pentru noul CLI cu comenzi help/status/echo'),
        /Planner did not produce any steps/i,
    );
});

test('AchillesCLI /specs command prints the stored sections', { concurrency: false, timeout: 10_000 }, async () => {
    const workspace = createWorkspace('specs-command');
    const output = createOutputBuffer();
    const cli = new AchillesCLI({
        llmAgent: createPlannerLLM([
            { skill: 'update-specs', prompt: 'Document demo CLI specifications.' },
        ], {
            'update-specs-plan': () => JSON.stringify([
                { action: 'createURS', title: 'URS demo', description: 'Demo requirement.' },
            ]),
        }),
        workspaceRoot: workspace,
        output,
        autoBootstrapMode: 'auto',
        interactive: false,
    });
    await cli.processTaskInput('Document demo CLI specifications.');
    await cli.showSpecifications('URS');
    const printed = output.buffer.join('');
    assert.match(printed, /URS-001/, 'URS section should be printed.');
    assert.match(printed, /Demo requirement/, 'URS content should be included.');
});

test('AchillesCLI status output lists workspace log files and duration buckets', { concurrency: false, timeout: 10_000 }, async () => {
    const workspace = createWorkspace('status-preview');
    const output = createOutputBuffer();
    resetLLMLogger();
    const cli = new AchillesCLI({
        llmAgent: createPlannerLLM([]),
        workspaceRoot: workspace,
        output,
        autoBootstrapMode: 'manual',
        interactive: false,
    });
    logLLMInteraction({
        prompt: 'status check',
        response: 'ok',
        model: 'demo',
        durationMs: 250,
    });

    cli.printStatus();
    const printed = output.buffer.join('');
    assert.match(printed, /\.specs\/\.llm_logs/, 'Status output should mention the workspace log file path.');
    assert.match(printed, /Response buckets:/, 'Status output should include bucket information.');
    assert.match(printed, /<1000/, 'Duration buckets should include <1000ms statistics.');
});
