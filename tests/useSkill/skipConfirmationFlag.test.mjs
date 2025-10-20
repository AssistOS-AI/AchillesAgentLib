/*
 * Test focus: Verify that the needConfirmation flag is respected.
 *
 * Scenario outline:
 *   1. When needConfirmation: false, the skill should execute immediately after all required
 *      parameters are collected, WITHOUT asking for user confirmation.
 *   2. When needConfirmation: true (or undefined), the skill should ask for confirmation
 *      before executing.
 *
 * Expectations:
 *   - Skills with needConfirmation: false skip the confirmation step
 *   - Skills with needConfirmation: true show confirmation and wait for "accept"
 *   - Default behavior (when flag is undefined) is to require confirmation
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { runUseSkillScenario } from './helpers.mjs';

const skillWithoutConfirmation = {
    specs: {
        name: 'list_items',
        humanDescription: 'a list of items',
        description: 'List all items in the inventory.',
        needConfirmation: false, // ← Should NOT ask for confirmation
        arguments: {
            category: { type: 'string', description: 'Item category to filter by' },
        },
        requiredArguments: [],
    },
    action: (args) => args,
    roles: ['viewer'],
};

const skillWithConfirmation = {
    specs: {
        name: 'delete_item',
        humanDescription: 'item deletion',
        description: 'Delete an item from the inventory.',
        needConfirmation: true, // ← Should ask for confirmation
        arguments: {
            item_id: { type: 'string', description: 'ID of the item to delete' },
        },
        requiredArguments: ['item_id'],
    },
    action: (args) => args,
    roles: ['admin'],
};

const skillDefaultConfirmation = {
    specs: {
        name: 'update_item',
        humanDescription: 'item update',
        description: 'Update an item in the inventory.',
        // needConfirmation is undefined - should default to true
        arguments: {
            item_id: { type: 'string', description: 'ID of the item to update' },
            new_name: { type: 'string', description: 'New name for the item' },
        },
        requiredArguments: ['item_id', 'new_name'],
    },
    action: (args) => args,
    roles: ['admin'],
};

test('useSkill skips confirmation when needConfirmation is false', async () => {
    const scenario = await runUseSkillScenario({
        agentName: 'ItemLister',
        taskDescription: 'List items in electronics category.',
        responses: [
            // No 'accept' needed! Should execute immediately after parameters are collected
        ],
        skillConfig: skillWithoutConfirmation,
        interceptExtraction: true,
        additionalMatchers: [
            { key: 'category', regex: /(?:category|items in)\s+([a-z]+)/i },
        ],
    });

    assert.ifError(scenario.error);
    assert.equal(scenario.actionCalls.length, 1, 'Action should execute immediately without confirmation');

    // Check that no confirmation prompt was shown
    const confirmationPrompts = scenario.prompts.filter(p =>
        p.includes('About to apply') || p.includes('Confirm by')
    );
    assert.equal(confirmationPrompts.length, 0, 'Should NOT show any confirmation prompts when needConfirmation is false');

    const result = scenario.result;
    assert.ok(result, 'Result should exist');

    // Handle different return structures: {category: 'electronics'} or 'electronics'
    const category = (typeof result === 'object' && result.category) ? result.category : result;
    const categoryStr = String(category || '');
    assert.ok(categoryStr.length > 0, 'Category value should not be empty');
    assert.match(categoryStr.toLowerCase(), /electronics/, 'Category should be electronics');
});

test('useSkill requires confirmation when needConfirmation is true', async () => {
    const scenario = await runUseSkillScenario({
        agentName: 'ItemDeleter',
        taskDescription: 'Delete the broken printer.',
        responses: [
            'Item ID is ITEM-123.',
            'accept', // ← Confirmation required
        ],
        skillConfig: skillWithConfirmation,
        interceptExtraction: true,
        additionalMatchers: [
            { key: 'item_id', regex: /item id (?:is|=)\s+([a-z0-9\-]+)/i },
        ],
    });

    assert.ifError(scenario.error);
    assert.equal(scenario.actionCalls.length, 1, 'Action should execute after confirmation');

    // Check that confirmation prompt WAS shown
    const confirmationPrompts = scenario.prompts.filter(p =>
        p.includes('About to apply') || p.includes('Confirm by')
    );
    assert.ok(confirmationPrompts.length >= 1, 'Should show confirmation prompt when needConfirmation is true');

    const result = scenario.result;
    // Handle both wrapped {item_id: 'X'} and direct 'X' returns
    const itemId = (typeof result === 'object' && result.item_id) ? result.item_id : result;
    assert.equal(itemId, 'ITEM-123', 'Should extract ITEM-123 as item_id');
});

test('useSkill defaults to requiring confirmation when needConfirmation is undefined', async () => {
    const scenario = await runUseSkillScenario({
        agentName: 'ItemUpdater',
        taskDescription: 'Update the printer name.',
        responses: [
            'Item ID is ITEM-456.',
            'New name is HP LaserJet.',
            'accept', // ← Confirmation should be required by default
        ],
        skillConfig: skillDefaultConfirmation,
        interceptExtraction: true,
        additionalMatchers: [
            { key: 'item_id', regex: /item id (?:is|=)\s+([a-z0-9\-]+)/i },
            { key: 'new_name', regex: /new name (?:is|=)\s+([a-z0-9 ]+)/i },
        ],
    });

    assert.ifError(scenario.error);
    assert.equal(scenario.actionCalls.length, 1, 'Action should execute after confirmation');

    // Check that confirmation prompt WAS shown (default behavior)
    const confirmationPrompts = scenario.prompts.filter(p =>
        p.includes('About to apply') || p.includes('Confirm by')
    );
    assert.ok(confirmationPrompts.length >= 1, 'Should show confirmation prompt by default');

    const result = scenario.result;
    assert.equal(result.item_id, 'ITEM-456');
    assert.match(result.new_name, /HP LaserJet/i);
});

test('useSkill with needConfirmation false executes even with optional parameters missing', async () => {
    const quickSkill = {
        specs: {
            name: 'quick_search',
            humanDescription: 'a quick search',
            description: 'Perform a quick search.',
            needConfirmation: false,
            arguments: {
                query: { type: 'string', description: 'Search query' },
                limit: { type: 'integer', description: 'Maximum results' },
            },
            requiredArguments: ['query'],
        },
        action: (args) => args,
        roles: ['user'],
    };

    const scenario = await runUseSkillScenario({
        agentName: 'Searcher',
        taskDescription: 'Search for laptops.',
        responses: [
            // Don't provide 'limit' - it's optional
            // Should execute immediately without asking for confirmation
        ],
        skillConfig: quickSkill,
        interceptExtraction: true,
        additionalMatchers: [
            { key: 'query', regex: /search for\s+([a-z]+)/i },
        ],
    });

    assert.ifError(scenario.error);
    assert.equal(scenario.actionCalls.length, 1, 'Action should execute immediately');

    const result = scenario.result;
    assert.match(result.query.toLowerCase(), /laptops/);
    assert.equal(result.limit, undefined, 'Optional parameter should be undefined');
});
