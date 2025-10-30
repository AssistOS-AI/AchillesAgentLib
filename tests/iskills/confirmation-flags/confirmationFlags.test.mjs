import test from 'node:test';
import assert from 'node:assert/strict';

import {
    runInteractiveSkillScenario,
    resolveTestDir,
} from '../helpers/runInteractiveSkillScenario.mjs';

const testDir = resolveTestDir(import.meta);

const categoryMatchers = [
    { key: 'category', regex: /(?:category|items in)\s+([a-z]+)/i },
];

const itemIdMatcher = { key: 'item_id', regex: /item id (?:is|=)\s+([a-z0-9\-]+)/i };
const newNameMatcher = { key: 'new_name', regex: /new name (?:is|=)\s+([a-z0-9 ]+)/i };
const queryMatcher = { key: 'query', regex: /search for\s+([a-z]+)/i };

const runScenario = async (t, options) => {
    const scenario = await runInteractiveSkillScenario({ testDir, ...options });
    if (scenario?.skipReason) {
        t.skip(scenario.skipReason);
        return null;
    }
    return scenario;
};

test('interactive skill skips confirmation when needConfirmation is false', async (t) => {
    const scenario = await runScenario(t, {
        skillName: 'list_items',
        taskDescription: 'List items in electronics category.',
        responses: [],
        additionalMatchers: categoryMatchers,
    });

    if (!scenario) {
        return;
    }

    assert.ifError(scenario.error);
    const confirmationPrompts = scenario.prompts.filter((prompt) =>
        prompt.includes('About to apply') || prompt.includes('Confirm by'),
    );
    assert.equal(confirmationPrompts.length, 0, 'No confirmation prompt should be shown');
    const category = typeof scenario.result === 'object'
        ? scenario.result.category
        : scenario.result;
    assert.match(String(category || '').toLowerCase(), /electronics/);
});

test('interactive skill requires confirmation when needConfirmation is true', async (t) => {
    const scenario = await runScenario(t, {
        skillName: 'delete_item',
        taskDescription: 'Delete the broken printer.',
        responses: [
            'Item ID is ITEM-123.',
            'accept',
        ],
        additionalMatchers: [itemIdMatcher],
    });

    if (!scenario) {
        return;
    }

    assert.ifError(scenario.error);
    const confirmationPrompts = scenario.prompts.filter((prompt) =>
        prompt.includes('About to apply') || prompt.includes('Confirm by'),
    );
    assert.ok(confirmationPrompts.length >= 1, 'Confirmation prompt should be shown');
    const result = scenario.result;
    const itemId = typeof result === 'object' ? result.item_id : result;
    assert.equal(itemId, 'ITEM-123');
});

test('interactive skill defaults to requiring confirmation when flag is undefined', async (t) => {
    const scenario = await runScenario(t, {
        skillName: 'update_item',
        taskDescription: 'Update the printer name.',
        responses: [
            'Item ID is ITEM-456.',
            'New name is HP LaserJet.',
            'accept',
        ],
        additionalMatchers: [itemIdMatcher, newNameMatcher],
    });

    if (!scenario) {
        return;
    }

    assert.ifError(scenario.error);
    const confirmationPrompts = scenario.prompts.filter((prompt) =>
        prompt.includes('About to apply') || prompt.includes('Confirm by'),
    );
    assert.ok(confirmationPrompts.length >= 1, 'Confirmation prompt should exist');
    assert.equal(scenario.result.item_id, 'ITEM-456');
    assert.match(scenario.result.new_name, /HP LaserJet/i);
});

test('interactive skill with needConfirmation false executes with optional values missing', async (t) => {
    const scenario = await runScenario(t, {
        skillName: 'quick_search',
        taskDescription: 'Search for laptops.',
        responses: [],
        additionalMatchers: [queryMatcher],
    });

    if (!scenario) {
        return;
    }

    assert.ifError(scenario.error);
    const confirmationPrompts = scenario.prompts.filter((prompt) =>
        prompt.includes('About to apply') || prompt.includes('Confirm by'),
    );
    assert.equal(confirmationPrompts.length, 0, 'No confirmation prompt should appear');
    assert.match(String(scenario.result.query || '').toLowerCase(), /laptops/);
    assert.equal(scenario.result.limit, undefined);
});
