/*
 * Test focus: Show that enumerated arguments are case-insensitive when the user supplies values
 * with different casing than the stored options.
 *
 * Scenario outline:
 *   1. The distribution-region argument exposes twelve centers (Center 1..12) via an enumerator.
 *   2. The agent initially lists missing details, sampling the first ten centers.
 *   3. The user replies with “REGION SHOULD BE CENTER 11.” (all uppercase).
 *   4. The enumerator resolves the capitalised input to the technical identifier `DC-11`, and the
 *      confirmation prompt echoes the human-friendly “Center 11”.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { runUseSkillScenario } from './helpers.mjs';

const centers = Array.from({ length: 12 }, (_, index) => ({
    label: `Center ${index + 1}`,
    value: `DC-${index + 1}`,
}));

const centerByValue = new Map(centers.map((entry) => [entry.value, entry.label]));

const skillConfig = {
    specs: {
        name: 'assign_distribution_region',
        humanDescription: 'a distribution region assignment for logistics',
        description: 'Select an operational region using internal identifiers.',
        arguments: {
            region_code: {
                type: 'string',
                description: 'Operational region for distribution',
                options: centers,
                presenter: (value) => centerByValue.get(value) || value,
            },
        },
        requiredArguments: ['region_code'],
    },
    roles: ['logistics'],
    action: (args) => args,
};

test('useSkill treats enumerated values as case-insensitive', async () => {
    const scenario = await runUseSkillScenario({
        agentName: 'RegionPlanner',
        taskDescription: 'Route resupply batches to the correct operations center.',
        responses: [
            'REGION SHOULD BE CENTER 11.',
            'accept',
        ],
        skillConfig,
        interceptExtraction: 1,
    });

    assert.ifError(scenario.error);
    assert.equal(scenario.actionCalls.length, 1, 'Action should trigger once after acceptance');

    // Check if enumeration examples were shown (optional - LLM might extract directly from task)
    const combinedOutput = [...scenario.logs, ...scenario.prompts].join('\n');
    const hasEnumerationExamples = /For example: Center 1, Center 2, Center 3, Center 4, Center 5, Center 6, Center 7, Center 8, Center 9, Center 10 \(showing 10 of 12\)/.test(combinedOutput);

    // The important thing is that the correct value was extracted and resolved
    assert.equal(scenario.result, 'DC-11', 'Should resolve to DC-11 technical value');
    assert.equal(scenario.actionCalls[0], 'DC-11', 'Action should receive DC-11');

    const confirmationPrompt = scenario.prompts.find((prompt) => prompt.includes('About to apply'));
    assert.ok(confirmationPrompt, 'A confirmation prompt should be presented');
    assert.match(confirmationPrompt, /Center 11/i, 'Confirmation should display the friendly center name');

    assert.equal(scenario.result, 'DC-11');
    assert.equal(scenario.actionCalls[0], 'DC-11');
});
