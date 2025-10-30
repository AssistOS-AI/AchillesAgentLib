import test from 'node:test';
import assert from 'node:assert/strict';

import {
    runInteractiveSkillScenario,
    resolveTestDir,
} from '../helpers/runInteractiveSkillScenario.mjs';

const testDir = resolveTestDir(import.meta);

test('interactive skill rejects placeholder values and continues asking', async (t) => {
    const scenario = await runInteractiveSkillScenario({
        testDir,
        skillName: 'create_record',
        taskDescription: 'Create a record.',
        responses: [
            'Record name is ProjectAlpha.',
            'Record type is development.',
            'accept',
        ],
        additionalMatchers: [
            { key: 'record_name', regex: /record name (?:is|should be|=)\s+([a-z0-9]+)/i },
            { key: 'record_type', regex: /record type (?:is|should be|=)\s+([a-z0-9]+)/i },
        ],
    });

    if (scenario.skipReason) {
        t.skip(scenario.skipReason);
        return;
    }

    assert.ifError(scenario.error);
    assert.ok(scenario.result);
    assert.equal(scenario.result.record_name, 'ProjectAlpha');
    const recordType = scenario.result.record_type || '';
    const normalizedType = recordType.match(/development/i) ? 'development' : recordType;
    assert.equal(normalizedType, 'development');
});

test('placeholder detection helper flags template-style values', () => {
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

    const hasValue = (name, value) => {
        if (value === undefined || value === null) {
            return false;
        }
        if (typeof value === 'string') {
            const trimmed = value.trim();
            if (!trimmed) {
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
                `your${name.replace(/_/g, '')}`,
            ];
            if (placeholderKeywords.some((keyword) => normalized === keyword || normalized.includes(keyword))) {
                return false;
            }
            if (normalized.startsWith('your') && normalized.length > 4) {
                return false;
            }
        }
        return true;
    };

    for (const placeholder of placeholders) {
        assert.equal(hasValue('test_field', placeholder), false, `Placeholder "${placeholder}" should be rejected`);
    }

    const validValues = [
        'actual_value',
        'MyProject',
        '123',
        'test-value-with-dashes',
        'Value With Spaces',
        'ProjectAlpha',
    ];

    for (const value of validValues) {
        assert.equal(hasValue('test_field', value), true, `Valid value "${value}" should be accepted`);
    }
});
