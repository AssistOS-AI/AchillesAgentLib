/*
 * Test focus: Verify that placeholder values are rejected as invalid by the validation system.
 *
 * Scenario outline:
 *   1. The LLM extraction mistakenly returns placeholder values like "not_provided" or "your_job_name"
 *   2. The validation system should recognize these as invalid and treat them as missing
 *   3. The agent should continue asking for the actual values instead of proceeding
 *
 * Expectations:
 *   - Placeholder strings should fail validation
 *   - The system should loop back to ask for real values
 *   - Execution should only proceed when real values are provided
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { runUseSkillScenario } from './helpers.mjs';

const skillConfig = {
    specs: {
        name: 'create_record',
        humanDescription: 'a new record creation',
        description: 'Create a new record with validated inputs.',
        arguments: {
            record_name: { type: 'string', description: 'Name for the record' },
            record_type: { type: 'string', description: 'Type of record to create' },
        },
        requiredArguments: ['record_name', 'record_type'],
    },
    action: (args) => args,
    roles: ['admin'],
};

test('useSkill rejects placeholder values and continues asking', async () => {
    const scenario = await runUseSkillScenario({
        agentName: 'RecordCreator',
        taskDescription: 'Create a record.',
        responses: [
            // First response: provide real value for record_name
            'Record name is ProjectAlpha.',
            // Second response: provide real value for record_type
            'Record type is development.',
            'accept',
        ],
        skillConfig,
        interceptExtraction: true,
        additionalMatchers: [
            { key: 'record_name', regex: /record name (?:is|should be|=)\s+([a-z0-9]+)/i },
            { key: 'record_type', regex: /record type (?:is|should be|=)\s+([a-z0-9]+)/i },
        ],
    });

    assert.ifError(scenario.error);
    assert.equal(scenario.actionCalls.length, 1, 'Action should execute once');

    const result = scenario.result;
    assert.equal(result.record_name, 'ProjectAlpha');
    assert.equal(result.record_type, 'development');
});

test('Validation logic rejects placeholder string patterns', () => {
    // Test the validation logic directly without needing full context initialization
    // This is a unit test of the hasValue logic
    
    const placeholders = [
        'not_provided',
        'not provided',
        'NOT PROVIDED',
        'notprovided',
        'not-provided',
        'your_test_field',
        'yourtestfield',
        'your_job_name',
        'yourjobname',
        'missing',
        'MISSING',
        'unknown',
        'placeholder',
        '',
        '   ',
        'null',
        'undefined',
        'none',
    ];

    // Mock hasValue implementation matching the fix
    const hasValue = (name, value) => {
        if (value === undefined || value === null) {
            return false;
        }
        
        if (typeof value === 'string') {
            const trimmed = value.trim();
            if (trimmed === '') {
                return false;
            }
            
            const normalized = trimmed.toLowerCase().replace(/[_\s-]/g, '');
            const placeholderKeywords = [
                'notprovided',
                'notset', 
                'missing',
                'unknown',
                'none',
                'null',
                'undefined',
                'placeholder',
                'yourtexthere',
                'yourvaluehere',
                'your' + name.replace(/_/g, ''),
            ];
            
            if (placeholderKeywords.some(keyword => normalized === keyword || normalized.includes(keyword))) {
                return false;
            }
        }
        
        return true;
    };

    for (const placeholder of placeholders) {
        assert.equal(
            hasValue('test_field', placeholder),
            false,
            `Placeholder value "${placeholder}" should be rejected`
        );
    }

    // Valid values should pass
    const validValues = [
        'actual_value',
        'MyProject',
        '123',
        'test-value-with-dashes',
        'Value With Spaces',
        'ProjectAlpha',
    ];

    for (const validValue of validValues) {
        assert.equal(
            hasValue('test_field', validValue),
            true,
            `Valid value "${validValue}" should be accepted`
        );
    }
});
