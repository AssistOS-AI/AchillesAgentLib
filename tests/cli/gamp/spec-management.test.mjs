import fs from 'node:fs';
import path from 'node:path';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

import GampRSP from '../../../cli/achilles-cli/GampRSP.mjs';
import updateSpecs from '../../../cli/achilles-cli/.AchillesSkills/gamp/update-specs/update-specs.js';
import reverseSpecs from '../../../cli/achilles-cli/.AchillesSkills/gamp/reverse-specs/reverse-specs.js';
import buildCode from '../../../cli/achilles-cli/.AchillesSkills/gamp/build-code/build-code.js';
import { LLMAgent } from '../../../LLMAgents/LLMAgent.mjs';

const TEMP_ROOT = path.join(process.cwd(), 'tests', '.tmp', 'spec-management');

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
    return dir;
};

const createLLM = (handlers = {}) => new LLMAgent({
    invokerStrategy: async ({ context }) => {
        if (context?.intent && handlers[context.intent]) {
            return handlers[context.intent](context);
        }
        return '[]';
    },
});

test('GampRSP links DS entries and enriches file impact metadata', async () => {
    const workspaceRoot = makeWorkspace('traceability');
    GampRSP.configure(workspaceRoot);
    const ursId = GampRSP.createURS('URS data integrity', 'Capture business expectation.');
    const fsId = GampRSP.createFS('FS audit trail', 'Record actions.', ursId);
    const dsId = GampRSP.createDS('DS audit logger', 'Implements audit logger.', 'Service handles persistence.', ursId, fsId);

    const fsDoc = fs.readFileSync(path.join(workspaceRoot, '.specs', 'FS.md'), 'utf8');
    assert.match(fsDoc, new RegExp(`- Linked DS:.*${dsId}`, 'i'), 'FS traceability must list the DS.');

    GampRSP.describeFile(
        dsId,
        'src/audit/logger.mjs',
        'Exports a logger utility.',
        ['createAuditEntry'],
        ['node:fs'],
        {
            why: 'Persist regulatory audit entries.',
            how: 'Wraps a buffered writer and json serializer.',
            what: 'Provides createAuditEntry(entry) API.',
            sideEffects: 'Writes to disk and updates metrics.',
            concurrency: 'Serialises writes through a mutex.',
        },
    );

    const dsDoc = fs.readFileSync(GampRSP.getDSFilePath(dsId), 'utf8');
    assert.match(dsDoc, /#### Why[\s\S]*Persist regulatory audit entries/);
    assert.match(dsDoc, /#### Side Effects[\s\S]*Writes to disk/);
});

test('update-specs executes LLM-driven actions', async () => {
    const workspaceRoot = makeWorkspace('update-specs');
    GampRSP.configure(workspaceRoot);
    const llm = createLLM({
        'update-specs-plan': () => JSON.stringify([
            { action: 'createURS', title: 'URS telemetry', description: 'Need telemetry pipeline.' },
            { action: 'createFS', title: 'FS telemetry', description: 'Expose telemetry capture.', ursId: 'URS-001' },
            { action: 'createDS', title: 'DS telemetry', description: 'Design for telemetry.', architecture: 'Stream events', ursId: 'URS-001', reqId: 'FS-001' },
            { action: 'createTest', dsId: 'DS-001', title: 'Telemetry test', description: 'Verify events recorded.' },
        ]),
    });

    const result = await updateSpecs({
        prompt: 'Add telemetry capture and monitoring.',
        context: { workspaceRoot, llmAgent: llm },
    });

    assert.equal(result.actions.length, 4);
    const fsDoc = fs.readFileSync(path.join(workspaceRoot, '.specs', 'FS.md'), 'utf8');
    assert.ok(fsDoc.includes('FS telemetry'));
    const dsDoc = fs.readFileSync(GampRSP.getDSFilePath('DS-001'), 'utf8');
    assert.ok(dsDoc.includes('DS telemetry'));
});

test('reverse-specs delegates per-file updates to LLM plans', async () => {
    const workspaceRoot = makeWorkspace('reverse-specs');
    fs.mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });
    fs.writeFileSync(path.join(workspaceRoot, 'src', 'app.mjs'), 'export const demo = () => true;\n');
    GampRSP.configure(workspaceRoot);

    const llm = createLLM({
        'reverse-specs-plan': () => JSON.stringify([
            { action: 'createURS', title: 'URS src coverage', description: 'Cover files.' },
            { action: 'createFS', title: 'FS src coverage', description: 'Track src app.', ursId: 'URS-001' },
            { action: 'createDS', title: 'DS src coverage', description: 'Design for src.', architecture: 'Simple module', ursId: 'URS-001', reqId: 'FS-001' },
            {
                action: 'describeFile',
                dsId: 'DS-001',
                filePath: 'src/app.mjs',
                description: 'Source file snapshot.',
                why: 'Document entry point.',
                how: 'Wraps module export.',
                what: 'Exports demo function.',
                sideEffects: 'None',
                concurrency: 'Stateless',
            },
        ]),
    });

    const outcome = await reverseSpecs({
        prompt: 'Sync specs with code.',
        context: { workspaceRoot, llmAgent: llm },
    });

    assert.equal(outcome.results.length, 1);
    const dsDoc = fs.readFileSync(GampRSP.getDSFilePath('DS-001'), 'utf8');
    assert.ok(dsDoc.includes('src/app.mjs'), 'DS file impact must include the source file.');
});

test('build-code generates files and scaffolds FS/NFS test suites', async () => {
    const workspaceRoot = makeWorkspace('build-code');
    GampRSP.configure(workspaceRoot);
    const ursId = GampRSP.createURS('URS service', 'Service baseline.');
    const fsId = GampRSP.createFS('FS service', 'Expose service API.', ursId);
    const dsId = GampRSP.createDS('DS service', 'Design API handlers.', 'Module architecture.', ursId, fsId);
    GampRSP.describeFile(
        dsId,
        'src/service/index.mjs',
        'Service orchestrator.',
        ['createService'],
        [],
        {
            why: 'Coordinate business flows.',
            how: 'Wraps lower-level modules.',
            what: 'Exports createService factory.',
            sideEffects: 'Logs operations.',
            concurrency: 'Single-threaded orchestrator.',
        },
    );

    const result = await buildCode({
        context: { workspaceRoot },
    });

    assert.ok(result.manifest.created.includes('src/service/index.mjs'), 'File should be created from DS impact.');
    const generated = fs.readFileSync(path.join(workspaceRoot, 'src', 'service', 'index.mjs'), 'utf8');
    assert.ok(generated.includes(`Managed by ${dsId}`));

    const runAllPath = path.join(workspaceRoot, 'runAlltests.js');
    const utilPath = path.join(workspaceRoot, 'tests', 'testUtil', 'index.mjs');
    const suiteTest = path.join(workspaceRoot, 'tests', fsId, `${fsId.toLowerCase()}.test.mjs`);
    assert.ok(fs.existsSync(runAllPath), 'runAlltests.js must exist.');
    assert.ok(fs.existsSync(utilPath), 'testUtil helper must exist.');
    assert.ok(fs.existsSync(suiteTest), 'Requirement-specific test must exist.');
});
