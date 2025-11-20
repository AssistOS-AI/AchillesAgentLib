import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { DBTableSkillsSubsystem } from '../../DBTableSkillsSubsystem/DBTableSkillsSubsystem.mjs';
import { serializeFunctions, generateAllFunctions } from '../../DBTableSkillsSubsystem/FunctionGenerator.mjs';
import { parseSkillMarkdown } from '../../DBTableSkillsSubsystem/SkillParser.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Mock LLM Agent for deterministic testing
class MockLLMAgent {
    constructor(options = {}) {
        this.mockResponses = options.mockResponses || {};
        this.callLog = [];
        this.callCount = 0;
    }

    async executePrompt(prompt, options = {}) {
        this.callLog.push({ prompt, options });
        this.callCount++;

        if (options.responseShape === 'json') {
            return {
                operation: 'SELECT',
                intent: 'Default operation',
                filter: {},
                data: null
            };
        }

        if (options.responseShape === 'code') {
            // Extract field name from prompt to generate unique function names
            const presenterMatch = prompt.match(/presenter_(\w+)/);
            const resolverMatch = prompt.match(/resolver_(\w+)/);
            const validatorMatch = prompt.match(/validator_(\w+)/);
            const enumeratorMatch = prompt.match(/enumerator_(\w+)/);
            const derivatorMatch = prompt.match(/derivator_(\w+)/);
            const fieldNameMatch = prompt.match(/fieldNamePresenter_(\w+)/);

            if (presenterMatch) {
                const fieldName = presenterMatch[1];
                return `function presenter_${fieldName}(value, record) {
    return String(value).toUpperCase();
}`;
            }
            if (resolverMatch) {
                const fieldName = resolverMatch[1];
                return `function resolver_${fieldName}(humanValue, record) {
    return String(humanValue).toLowerCase();
}`;
            }
            if (validatorMatch) {
                const fieldName = validatorMatch[1];
                return `function validator_${fieldName}(value, record) {
    if (!value) return JSON.stringify({ field: '${fieldName}', error: 'Required', value });
    return '';
}`;
            }
            if (enumeratorMatch) {
                const fieldName = enumeratorMatch[1];
                return `function enumerator_${fieldName}(currentRecord) {
    return ['active', 'inactive'];
}`;
            }
            if (derivatorMatch) {
                const fieldName = derivatorMatch[1];
                return `function derivator_${fieldName}(record) {
    return 'derived_value';
}`;
            }
            if (fieldNameMatch) {
                const fieldName = fieldNameMatch[1];
                return `function fieldNamePresenter_${fieldName}() {
    return '${fieldName.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}';
}`;
            }
            return `function mockFunction(value) { return String(value); }`;
        }

        return 'Mock LLM response';
    }
}

// Mock database adapter
class MockDBAdapter {
    constructor() {
        this.data = new Map();
    }
}

// ============================================================================
// SECTION 1: serializeFunctions Tests
// ============================================================================

test('serializeFunctions: Creates valid module with tskillSource', () => {
    const mockFunctions = {
        presenters: {
            presenter_name: 'function presenter_name(value) { return value; }'
        },
        resolvers: {},
        validators: {},
        enumerators: {},
        derivators: {},
        fieldNamePresenters: {},
        global: {
            selectRecords: 'async function selectRecords(filter) { return []; }',
            prepareRecord: 'async function prepareRecord(record) { return record; }',
            validateRecord: 'async function validateRecord(record) { return { isValid: true, errors: [] }; }',
            presentRecord: 'async function presentRecord(record) { return record; }',
            generatePKValues: 'function generatePKValues(record) { return { id: 1 }; }'
        }
    };

    const tskillSource = '# Test Skill\n## Table Purpose\nTest\n## Fields\n### name';
    const serialized = serializeFunctions(mockFunctions, tskillSource);

    // Verify structure
    assert.ok(serialized.includes('export const tskillSource ='), 'Should export tskillSource');
    assert.ok(serialized.includes('export const functions ='), 'Should export functions object');
    assert.ok(serialized.includes('export function presenter_name'), 'Should export presenter function');
    assert.ok(serialized.includes('export async function selectRecords'), 'Should export global functions');
});

test('serializeFunctions: Handles empty function categories', () => {
    const mockFunctions = {
        presenters: {},
        resolvers: {},
        validators: {},
        enumerators: {},
        derivators: {},
        fieldNamePresenters: {},
        global: {
            selectRecords: 'async function selectRecords(filter) { return []; }'
        }
    };

    const serialized = serializeFunctions(mockFunctions, 'test');

    // Should not crash and should have valid structure
    assert.ok(serialized.includes('export const tskillSource ='));
    assert.ok(serialized.includes('export const functions ='));
    assert.ok(serialized.includes('presenters: {'), 'Should have empty presenters object');
});

test('serializeFunctions: Adds export prefix if missing', () => {
    const mockFunctions = {
        presenters: {
            presenter_name: 'function presenter_name(value) { return value; }' // No export prefix
        },
        resolvers: {},
        validators: {},
        enumerators: {},
        derivators: {},
        fieldNamePresenters: {},
        global: {
            selectRecords: 'async function selectRecords(filter) { return []; }' // No export prefix
        }
    };

    const serialized = serializeFunctions(mockFunctions, 'test');

    // Should add export prefix
    assert.ok(serialized.includes('export function presenter_name'), 'Should add export to presenter');
    assert.ok(serialized.includes('export async function selectRecords'), 'Should add export to global function');
});

// ============================================================================
// SECTION 2: File-based Caching Tests
// ============================================================================

test('File caching: Creates tskill.generated.mjs on first prepare', async (t) => {
    const llmAgent = new MockLLMAgent();
    const mockDB = new MockDBAdapter();
    const subsystem = new DBTableSkillsSubsystem({
        llmAgent,
        dbAdapter: mockDB
    });

    // Create a temporary test skill directory
    const testDir = path.join(__dirname, '.test-cache', 'skill-' + Date.now());
    await fs.promises.mkdir(testDir, { recursive: true });

    try {
        // Create a simple tskill.md - must have proper table name format
        const tskillContent = `# Test Skill
## Table Purpose
Test table

## Fields
### id
#### Description
Primary key
#### PrimaryKey
Auto-increment
`;

        const tskillPath = path.join(testDir, 'tskill.md');
        await fs.promises.writeFile(tskillPath, tskillContent, 'utf-8');

        const skillRecord = {
            name: 'test-skill',
            type: 'dbtable',
            descriptor: {},
            skillDir: testDir,
            filePath: tskillPath
        };

        // Prepare skill
        await subsystem.prepareSkill(skillRecord);

        // Check that generated file was created
        const generatedPath = path.join(testDir, 'tskill.generated.mjs');
        assert.ok(fs.existsSync(generatedPath), 'Generated file should be created');

        // Check file content
        const generatedContent = await fs.promises.readFile(generatedPath, 'utf-8');
        assert.ok(generatedContent.includes('export const tskillSource ='), 'Should contain tskillSource');
        assert.ok(generatedContent.includes('export const functions ='), 'Should contain functions export');
        // tskillSource is JSON-stringified, so check for the JSON representation
        const tskillSourceJSON = JSON.stringify(tskillContent);
        assert.ok(generatedContent.includes(tskillSourceJSON), 'Should contain original tskill content as JSON');

    } finally {
        // Cleanup
        await fs.promises.rm(testDir, { recursive: true, force: true });
    }
});

test('File caching: Reuses generated file when content unchanged', async (t) => {
    const llmAgent = new MockLLMAgent();
    const mockDB = new MockDBAdapter();
    const subsystem = new DBTableSkillsSubsystem({
        llmAgent,
        dbAdapter: mockDB
    });

    const testDir = path.join(__dirname, '.test-cache', 'skill-' + Date.now());
    await fs.promises.mkdir(testDir, { recursive: true });

    try {
        const tskillContent = `# Test Skill
## Table Purpose
Test table

## Fields
### id
#### Description
Primary key
#### PrimaryKey
Auto-increment
`;

        const tskillPath = path.join(testDir, 'tskill.md');
        await fs.promises.writeFile(tskillPath, tskillContent, 'utf-8');

        const skillRecord1 = {
            name: 'test-skill-1',
            type: 'dbtable',
            descriptor: {},
            skillDir: testDir,
            filePath: tskillPath
        };

        // First prepare
        await subsystem.prepareSkill(skillRecord1);
        const firstCallCount = llmAgent.callCount;

        // Reset LLM agent to track new calls
        llmAgent.callCount = 0;

        const skillRecord2 = {
            name: 'test-skill-2',
            type: 'dbtable',
            descriptor: {},
            skillDir: testDir,
            filePath: tskillPath
        };

        // Second prepare with same content - should reuse cached file
        await subsystem.prepareSkill(skillRecord2);
        const secondCallCount = llmAgent.callCount;

        // Should make zero LLM calls since it loads from generated file
        assert.equal(secondCallCount, 0,
            `Second prepare should make no LLM calls (reusing cache), but made ${secondCallCount}`);

    } finally {
        await fs.promises.rm(testDir, { recursive: true, force: true });
    }
});

test('File caching: Regenerates when content changes with context', async (t) => {
    const llmAgent = new MockLLMAgent();
    const mockDB = new MockDBAdapter();
    const subsystem = new DBTableSkillsSubsystem({
        llmAgent,
        dbAdapter: mockDB
    });

    const testDir = path.join(__dirname, '.test-cache', 'skill-' + Date.now());
    await fs.promises.mkdir(testDir, { recursive: true });

    try {
        const tskillContent1 = `# TestOne Skill
## Table Purpose
Test table version 1

## Fields
### id
#### Description
Primary key
#### PrimaryKey
Auto-increment

### name
#### Description
Name field
#### Field Value Presenter
Show in uppercase
`;

        const tskillPath = path.join(testDir, 'tskill.md');
        await fs.promises.writeFile(tskillPath, tskillContent1, 'utf-8');

        const skillRecord1 = {
            name: 'test-skill',
            type: 'dbtable',
            descriptor: {},
            skillDir: testDir,
            filePath: tskillPath
        };

        // First prepare
        await subsystem.prepareSkill(skillRecord1);

        // Read generated file
        const generatedPath = path.join(testDir, 'tskill.generated.mjs');
        const generatedContent1 = await fs.promises.readFile(generatedPath, 'utf-8');
        assert.ok(generatedContent1.includes('Test table version 1'), 'Should contain v1 content');

        // Change tskill content
        const tskillContent2 = `# TestTwo Skill
## Table Purpose
Test table version 2 - UPDATED

## Fields
### id
#### Description
Primary key
#### PrimaryKey
Auto-increment

### name
#### Description
Name field
#### Field Value Presenter
Show in lowercase
`;

        await fs.promises.writeFile(tskillPath, tskillContent2, 'utf-8');

        const skillRecord2 = {
            name: 'test-skill',
            type: 'dbtable',
            descriptor: {},
            skillDir: testDir,
            filePath: tskillPath
        };

        // Track LLM calls to verify regeneration
        const callsBeforeRegeneration = llmAgent.callLog.length;

        // Second prepare with changed content
        await subsystem.prepareSkill(skillRecord2);

        // Should have made new LLM calls for regeneration
        const callsAfterRegeneration = llmAgent.callLog.length;
        assert.ok(callsAfterRegeneration > callsBeforeRegeneration,
            'Should make LLM calls to regenerate functions');

        // Check that generated file was updated
        const generatedContent2 = await fs.promises.readFile(generatedPath, 'utf-8');
        assert.ok(generatedContent2.includes('Test table version 2 - UPDATED'),
            'Generated file should contain updated content');
        assert.ok(!generatedContent2.includes('Test table version 1'),
            'Generated file should not contain old content');

        // Verify that context was passed (check if prompts mention "Previous")
        const regenerationCalls = llmAgent.callLog.slice(callsBeforeRegeneration);
        const hasContextPrompts = regenerationCalls.some(call =>
            call.prompt.includes('Previous implementation') ||
            call.prompt.includes('Previous Skill Definition') ||
            call.prompt.includes('New Skill Definition')
        );
        assert.ok(hasContextPrompts, 'Should pass context to LLM during regeneration');

    } finally {
        await fs.promises.rm(testDir, { recursive: true, force: true });
    }
});

test('File caching: Falls back to fresh generation on corrupted file', async (t) => {
    const llmAgent = new MockLLMAgent();
    const mockDB = new MockDBAdapter();
    const subsystem = new DBTableSkillsSubsystem({
        llmAgent,
        dbAdapter: mockDB
    });

    const testDir = path.join(__dirname, '.test-cache', 'skill-' + Date.now());
    await fs.promises.mkdir(testDir, { recursive: true });

    try {
        const tskillContent = `# Test Skill
## Table Purpose
Test table

## Fields
### id
#### Description
Primary key
#### PrimaryKey
Auto-increment
`;

        const tskillPath = path.join(testDir, 'tskill.md');
        await fs.promises.writeFile(tskillPath, tskillContent, 'utf-8');

        // Create a corrupted generated file
        const generatedPath = path.join(testDir, 'tskill.generated.mjs');
        await fs.promises.writeFile(generatedPath, 'CORRUPTED CONTENT!!', 'utf-8');

        const skillRecord = {
            name: 'test-skill',
            type: 'dbtable',
            descriptor: {},
            skillDir: testDir,
            filePath: tskillPath
        };

        // Should not throw error, should regenerate
        await subsystem.prepareSkill(skillRecord);

        // Verify skill was prepared successfully
        assert.ok(skillRecord.metadata, 'Should have metadata');
        assert.ok(skillRecord.metadata.functions, 'Should have functions');

        // Check that file was regenerated
        const generatedContent = await fs.promises.readFile(generatedPath, 'utf-8');
        assert.ok(generatedContent.includes('export const tskillSource ='),
            'Should regenerate valid file');
        assert.ok(!generatedContent.includes('CORRUPTED'),
            'Should replace corrupted content');

    } finally {
        await fs.promises.rm(testDir, { recursive: true, force: true });
    }
});

// ============================================================================
// SECTION 3: Execution Context Tests
// ============================================================================

test('createExecutionContext: Uses compiled functions from module import', async (t) => {
    const llmAgent = new MockLLMAgent();
    const mockDB = new MockDBAdapter();
    const subsystem = new DBTableSkillsSubsystem({
        llmAgent,
        dbAdapter: mockDB
    });

    const testDir = path.join(__dirname, '.test-cache', 'skill-' + Date.now());
    await fs.promises.mkdir(testDir, { recursive: true });

    try {
        const tskillContent = `# Test Skill
## Table Purpose
Test table

## Fields
### id
#### Description
Primary key
#### PrimaryKey
Auto-increment

### name
#### Description
Name field
#### Field Value Presenter
Show in uppercase
`;

        const tskillPath = path.join(testDir, 'tskill.md');
        await fs.promises.writeFile(tskillPath, tskillContent, 'utf-8');

        const skillRecord = {
            name: 'test-skill',
            type: 'dbtable',
            descriptor: {},
            skillDir: testDir,
            filePath: tskillPath
        };

        await subsystem.prepareSkill(skillRecord);

        // Get execution context
        const functions = skillRecord.metadata.functions;
        const execContext = subsystem.createExecutionContext(functions);

        // Should return compiled functions directly (not eval'd)
        assert.ok(execContext, 'Should create execution context');
        assert.ok(typeof execContext.selectRecords === 'function',
            'Should have selectRecords function');
        assert.ok(typeof execContext.prepareRecord === 'function',
            'Should have prepareRecord function');
        assert.ok(typeof execContext.validateRecord === 'function',
            'Should have validateRecord function');
        assert.ok(typeof execContext.presentRecord === 'function',
            'Should have presentRecord function');

        // Verify functions are actually callable
        const testRecord = { id: 1, name: 'test' };
        const presented = await execContext.presentRecord(testRecord);
        assert.ok(presented, 'Should be able to call presentRecord');

    } finally {
        await fs.promises.rm(testDir, { recursive: true, force: true });
    }
});

test('createExecutionContext: Falls back to eval for non-module functions', () => {
    const subsystem = new DBTableSkillsSubsystem({
        llmAgent: new MockLLMAgent(),
        dbAdapter: new MockDBAdapter()
    });

    // Create mock functions in string format (not from module import)
    const mockFunctions = {
        presenters: {
            presenter_name: 'function presenter_name(value) { return value; }'
        },
        resolvers: {},
        validators: {},
        enumerators: {},
        derivators: {},
        fieldNamePresenters: {},
        global: {
            selectRecords: 'async function selectRecords(filter) { return []; }',
            prepareRecord: 'async function prepareRecord(record) { return record; }',
            validateRecord: 'async function validateRecord(record) { return { isValid: true, errors: [] }; }',
            presentRecord: 'async function presentRecord(record) { return record; }',
            generatePKValues: 'function generatePKValues(record) { return { id: 1 }; }'
        }
    };

    const execContext = subsystem.createExecutionContext(mockFunctions);

    // Should still create valid context using eval
    assert.ok(execContext, 'Should create execution context');
    assert.ok(typeof execContext.selectRecords === 'function',
        'Should have selectRecords function');
});

// ============================================================================
// SECTION 4: Integration Tests
// ============================================================================

test('Integration: Full workflow with file caching', async (t) => {
    const llmAgent = new MockLLMAgent();
    const mockDB = new MockDBAdapter();
    const subsystem = new DBTableSkillsSubsystem({
        llmAgent,
        dbAdapter: mockDB
    });

    const testDir = path.join(__dirname, '.test-cache', 'skill-' + Date.now());
    await fs.promises.mkdir(testDir, { recursive: true });

    try {
        const tskillContent = `# Customer Skill
## Table Purpose
Manage customers

## Fields
### customer_id
#### Description
Primary key
#### PrimaryKey
Auto-increment

### name
#### Description
Customer name
#### Field Value Presenter
Show in title case
#### Field Value Resolver
Convert to title case
#### Field Value Validator
Must be at least 2 characters
#### Field Value Is Required
Always required

### email
#### Description
Email address
#### Field Value Presenter
Show in lowercase
#### Field Value Resolver
Convert to lowercase
#### Field Value Validator
Must be valid email format
#### Field Value Is Required
Always required
`;

        const tskillPath = path.join(testDir, 'tskill.md');
        await fs.promises.writeFile(tskillPath, tskillContent, 'utf-8');

        const skillRecord = {
            name: 'customer-skill',
            type: 'dbtable',
            descriptor: {
                title: 'Customer Management',
                summary: 'Manage customer records'
            },
            skillDir: testDir,
            filePath: tskillPath
        };

        // First prepare
        await subsystem.prepareSkill(skillRecord);

        // Verify metadata
        assert.ok(skillRecord.metadata, 'Should have metadata');
        assert.equal(skillRecord.metadata.type, 'dbtable');
        assert.ok(skillRecord.metadata.functions, 'Should have functions');
        assert.ok(skillRecord.metadata.functions.presenters, 'Should have presenters');
        assert.ok(skillRecord.metadata.functions.resolvers, 'Should have resolvers');
        assert.ok(skillRecord.metadata.functions.validators, 'Should have validators');

        // Verify generated file exists
        const generatedPath = path.join(testDir, 'tskill.generated.mjs');
        assert.ok(fs.existsSync(generatedPath), 'Generated file should exist');

        // Execute a skill prompt
        const result = await subsystem.executeSkillPrompt({
            skillRecord,
            promptText: 'Show all customers',
            options: {
                args: {
                    prompt: 'Show all customers'
                }
            }
        });

        assert.ok(result, 'Should have result');
        assert.equal(result.skill, 'customer-skill');
        assert.ok(result.result, 'Should have result.result');
        assert.equal(result.result.operation, 'SELECT');

    } finally {
        await fs.promises.rm(testDir, { recursive: true, force: true });
    }
});

test('Integration: Multiple skills share same content cache correctly', async (t) => {
    const llmAgent = new MockLLMAgent();
    const mockDB = new MockDBAdapter();
    const subsystem = new DBTableSkillsSubsystem({
        llmAgent,
        dbAdapter: mockDB
    });

    const testDir1 = path.join(__dirname, '.test-cache', 'skill-' + Date.now() + '-1');
    const testDir2 = path.join(__dirname, '.test-cache', 'skill-' + Date.now() + '-2');
    await fs.promises.mkdir(testDir1, { recursive: true });
    await fs.promises.mkdir(testDir2, { recursive: true });

    try {
        const tskillContent = `# Test Skill
## Table Purpose
Test table

## Fields
### id
#### Description
Primary key
#### PrimaryKey
Auto-increment
`;

        // Create same content in two directories
        const tskillPath1 = path.join(testDir1, 'tskill.md');
        const tskillPath2 = path.join(testDir2, 'tskill.md');
        await fs.promises.writeFile(tskillPath1, tskillContent, 'utf-8');
        await fs.promises.writeFile(tskillPath2, tskillContent, 'utf-8');

        const skillRecord1 = {
            name: 'test-skill-1',
            type: 'dbtable',
            descriptor: {},
            skillDir: testDir1,
            filePath: tskillPath1
        };

        const skillRecord2 = {
            name: 'test-skill-2',
            type: 'dbtable',
            descriptor: {},
            skillDir: testDir2,
            filePath: tskillPath2
        };

        // Prepare both skills
        await subsystem.prepareSkill(skillRecord1);
        await subsystem.prepareSkill(skillRecord2);

        // Both should have their own generated files
        const generatedPath1 = path.join(testDir1, 'tskill.generated.mjs');
        const generatedPath2 = path.join(testDir2, 'tskill.generated.mjs');
        assert.ok(fs.existsSync(generatedPath1), 'First generated file should exist');
        assert.ok(fs.existsSync(generatedPath2), 'Second generated file should exist');

        // Both should work independently
        assert.ok(skillRecord1.metadata, 'First skill should have metadata');
        assert.ok(skillRecord2.metadata, 'Second skill should have metadata');

    } finally {
        await fs.promises.rm(testDir1, { recursive: true, force: true });
        await fs.promises.rm(testDir2, { recursive: true, force: true });
    }
});
