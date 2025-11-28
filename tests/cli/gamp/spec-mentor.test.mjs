import fs from 'node:fs';
import path from 'node:path';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

import specMentor from '../../../cli/achilles-cli/.AchillesSkills/gamp/spec-mentor/spec-mentor.js';
import specReview from '../../../cli/achilles-cli/.AchillesSkills/gamp/spec-review/spec-review.js';
import specHelp from '../../../cli/achilles-cli/.AchillesSkills/gamp/spec-help/spec-help.js';
import GampRSP from '../../../cli/achilles-cli/GampRSP.mjs';
import { LLMAgent } from '../../../LLMAgents/LLMAgent.mjs';

const TEMP_ROOT = path.join(process.cwd(), 'tests', '.tmp', 'spec-mentor');

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

test('spec-mentor produces educational guidance with approval step', async () => {
    const workspaceRoot = makeWorkspace('mentor');
    GampRSP.configure(workspaceRoot);
    const ursId = GampRSP.createURS('URS data integrity', 'Protect lab data.');
    GampRSP.createFS('FS audit logging', 'Log write operations.', ursId);
    GampRSP.createNFS('NFS availability', 'Ensure 99.5% uptime.', ursId);

    const llm = new LLMAgent({
        invokerStrategy: async ({ context }) => {
            if (context?.intent === 'spec-mentor-education') {
                return JSON.stringify({
                    overview: 'URS-001 is covered but FS/NFS need implementation steps.',
                    ursHighlights: ['URS-001 focuses on data integrity.'],
                    fsIdeas: ['FS-001: add DS for audit service.'],
                    nfsIdeas: ['Tie NFS-001 to monitoring DS.'],
                    dsCandidates: ['Create DS-analytics for reporting.'],
                    testImpacts: ['Add TEST-010 for audit trail.'],
                    approvalQuestion: 'Approve this plan?',
                });
            }
            return '[]';
        },
    });

    const result = await specMentor({
        prompt: 'Need clarity on audit requirements.',
        context: { workspaceRoot, llmAgent: llm },
    });

    assert.equal(result.requiresApproval, true, 'Skill should request approval.');
    assert.match(result.education.overview, /URS-001/, 'Overview should reference URS.');
    assert.ok(result.education.fsIdeas.some((idea) => idea.includes('FS-001')), 'FS ideas should mention requirement IDs.');
    assert.ok(result.education.testImpacts.length >= 1, 'Test impacts should be captured.');
    assert.match(result.education.approvalQuestion, /Approve/, 'Approval question should be present.');
});

test('spec-review surfaces structured findings and recommendations', async () => {
    const workspaceRoot = makeWorkspace('review');
    GampRSP.configure(workspaceRoot);
    const ursId = GampRSP.createURS('URS backup', 'Need backup process.');
    GampRSP.createFS('FS backup', 'Nightly backups', ursId);

    const llm = new LLMAgent({
        invokerStrategy: async ({ context }) => {
            if (context?.intent === 'spec-review-analysis') {
                return JSON.stringify({
                    summary: 'Backups defined but DS/tests missing.',
                    issues: [
                        {
                            id: 'FS-001',
                            severity: 'high',
                            finding: 'No DS implements backup.',
                            recommendation: 'Create DS and describe file impacts.',
                        },
                    ],
                    testGaps: ['Add TEST-201 for backup restore'],
                });
            }
            return '[]';
        },
    });

    const result = await specReview({
        prompt: 'Verify backup readiness.',
        context: { workspaceRoot, llmAgent: llm },
    });

    assert.match(result.review.summary, /DS/, 'Summary should mention missing DS.');
    assert.equal(result.review.issues.length, 1, 'Expected a single finding.');
    assert.equal(result.review.issues[0].severity, 'high');
    assert.ok(result.review.testGaps.includes('Add TEST-201 for backup restore'));
});

test('spec-help explains lifecycle and best practices (LLM path)', async () => {
    const workspaceRoot = makeWorkspace('help');
    GampRSP.configure(workspaceRoot);

    const llm = new LLMAgent({
        invokerStrategy: async ({ context }) => {
            if (context?.intent === 'spec-help-overview') {
                return JSON.stringify({
                    introduction: 'GAMP specs link URS to DS/test evidence.',
                    keyConcepts: ['Traceability is mandatory'],
                    lifecycleSteps: ['URS -> FS -> DS -> Tests'],
                    bestPractices: ['Document file impacts per DS'],
                    closingThoughts: 'Keep specs authoritative.',
                });
            }
            return '[]';
        },
    });

    const result = await specHelp({
        context: { workspaceRoot, llmAgent: llm },
    });

    assert.match(result.help.introduction, /GAMP/, 'Introduction should reference GAMP.');
    assert.ok(result.help.keyConcepts.length >= 1, 'Key concepts should be populated.');
    assert.ok(result.help.lifecycleSteps.some((step) => step.includes('URS')), 'Lifecycle should mention URS.');
    assert.match(result.help.closingThoughts, /authoritative/, 'Closing thoughts should encourage discipline.');
});
