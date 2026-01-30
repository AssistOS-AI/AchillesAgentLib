/**
 * Integration Tests for tskill spec generation flow
 *
 * Tests the tskillToSpecs function that generates mirror-code-generator
 * compatible specs from parsed tskill.md definitions.
 *
 * Flow being tested:
 *   tskill.md -> parseSkillMarkdown() -> tskillToSpecs() -> specs/tskill.generated.mjs.md
 */

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { tskillToSpecs } from '../../DBTableSkillsSubsystem/tskillToSpecs.mjs';
import { parseSkillMarkdown, validateSkill } from '../../DBTableSkillsSubsystem/SkillParser.mjs';

// ============================================================================
// Test Fixtures
// ============================================================================

const SIMPLE_TSKILL = `# Products Skill

## Table Purpose
Manage product inventory for an e-commerce system.

## Fields

### product_id

#### Description
Unique identifier for each product (UUID)

#### PrimaryKey
UUID auto-generated

### name

#### Description
Product display name (string, max 200 characters)

#### Field Value Presenter
Display in Title Case

#### Field Value Validator
Must be between 2 and 200 characters

#### Field Value Is Required
Always required

### price

#### Description
Product price in cents (integer)

#### Field Value Presenter
Format as currency with dollar sign

#### Field Value Resolver
Convert decimal input to cents (multiply by 100)

#### Field Value Validator
Must be a positive integer

#### Field Value Is Required
Always required

### status

#### Description
Product availability status

#### Field Value Enumerator
Return ["active", "inactive", "discontinued"]

#### Field Value Validator
Must be one of: active, inactive, discontinued

## Business Rules

- Product names must be unique
- Price cannot be negative
`;

const TSKILL_WITH_DERIVED = `# Orders Skill

## Table Purpose
Track customer orders with computed totals.

## Fields

### order_id

#### Description
Unique order identifier (integer, auto-increment)

#### PrimaryKey
Auto-increment starting from 1000

### quantity

#### Description
Number of items ordered

#### Field Value Validator
Must be a positive integer greater than 0

#### Field Value Is Required
Always required

### unit_price

#### Description
Price per unit in cents

#### Field Value Is Required
Always required

### total

#### Description
Computed total (quantity * unit_price)

#### Field Value Derivator
Multiply quantity by unit_price to get total

## Business Rules

- Orders cannot have zero quantity
`;

const MINIMAL_TSKILL = `# Notes Skill

## Table Purpose
Simple notes storage.

## Fields

### note_id

#### Description
Unique note identifier

#### PrimaryKey
UUID

### content

#### Description
Note text content
`;

// ============================================================================
// Helper Functions
// ============================================================================

async function createTempSkillDir(tskillContent) {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tskill-test-'));
    const tskillPath = path.join(tempDir, 'tskill.md');
    await fs.writeFile(tskillPath, tskillContent, 'utf-8');
    return tempDir;
}

async function cleanupTempDir(tempDir) {
    try {
        await fs.rm(tempDir, { recursive: true, force: true });
    } catch (e) {
        // Ignore cleanup errors
    }
}

// ============================================================================
// tskillToSpecs Function Tests
// ============================================================================

test('tskillToSpecs: creates specs directory if not exists', async () => {
    const tempDir = await createTempSkillDir(SIMPLE_TSKILL);

    try {
        const content = await fs.readFile(path.join(tempDir, 'tskill.md'), 'utf-8');
        const parsedSkill = parseSkillMarkdown(content);

        const specPath = await tskillToSpecs(tempDir, parsedSkill);

        // Check specs directory was created
        const specsDir = path.join(tempDir, 'specs');
        const stat = await fs.stat(specsDir);
        assert.ok(stat.isDirectory(), 'specs/ directory should be created');

        // Check spec file exists
        assert.ok(specPath.endsWith('tskill.generated.mjs.md'), 'Should return correct spec path');
        const specExists = await fs.stat(specPath).then(() => true).catch(() => false);
        assert.ok(specExists, 'Spec file should exist');
    } finally {
        await cleanupTempDir(tempDir);
    }
});

test('tskillToSpecs: generates spec with correct header', async () => {
    const tempDir = await createTempSkillDir(SIMPLE_TSKILL);

    try {
        const content = await fs.readFile(path.join(tempDir, 'tskill.md'), 'utf-8');
        const parsedSkill = parseSkillMarkdown(content);

        const specPath = await tskillToSpecs(tempDir, parsedSkill);
        const specContent = await fs.readFile(specPath, 'utf-8');

        assert.ok(
            specContent.includes('# Specification for tskill.generated.mjs - Products Database Functions'),
            'Should include proper header with table name'
        );
    } finally {
        await cleanupTempDir(tempDir);
    }
});

test('tskillToSpecs: includes module description with table purpose', async () => {
    const tempDir = await createTempSkillDir(SIMPLE_TSKILL);

    try {
        const content = await fs.readFile(path.join(tempDir, 'tskill.md'), 'utf-8');
        const parsedSkill = parseSkillMarkdown(content);

        const specPath = await tskillToSpecs(tempDir, parsedSkill);
        const specContent = await fs.readFile(specPath, 'utf-8');

        assert.ok(specContent.includes('## Module Description'), 'Should include module description section');
        assert.ok(
            specContent.includes('Manage product inventory for an e-commerce system'),
            'Should include table purpose'
        );
        assert.ok(specContent.includes('**Fields:**'), 'Should list fields');
    } finally {
        await cleanupTempDir(tempDir);
    }
});

test('tskillToSpecs: generates validator specs for required fields', async () => {
    const tempDir = await createTempSkillDir(SIMPLE_TSKILL);

    try {
        const content = await fs.readFile(path.join(tempDir, 'tskill.md'), 'utf-8');
        const parsedSkill = parseSkillMarkdown(content);

        const specPath = await tskillToSpecs(tempDir, parsedSkill);
        const specContent = await fs.readFile(specPath, 'utf-8');

        // Check for validator function specs
        assert.ok(
            specContent.includes('## Function: validator_name(value, record)'),
            'Should include validator for name field'
        );
        assert.ok(
            specContent.includes('## Function: validator_price(value, record)'),
            'Should include validator for price field'
        );

        // Check validator content
        assert.ok(
            specContent.includes('**This field is required.**'),
            'Should indicate required fields'
        );
        assert.ok(
            specContent.includes('Must be between 2 and 200 characters'),
            'Should include validation description'
        );
    } finally {
        await cleanupTempDir(tempDir);
    }
});

test('tskillToSpecs: generates presenter specs for fields with presenters', async () => {
    const tempDir = await createTempSkillDir(SIMPLE_TSKILL);

    try {
        const content = await fs.readFile(path.join(tempDir, 'tskill.md'), 'utf-8');
        const parsedSkill = parseSkillMarkdown(content);

        const specPath = await tskillToSpecs(tempDir, parsedSkill);
        const specContent = await fs.readFile(specPath, 'utf-8');

        assert.ok(
            specContent.includes('## Function: presenter_name(value, record)'),
            'Should include presenter for name field'
        );
        assert.ok(
            specContent.includes('## Function: presenter_price(value, record)'),
            'Should include presenter for price field'
        );
        assert.ok(
            specContent.includes('Display in Title Case'),
            'Should include presenter description for name'
        );
        assert.ok(
            specContent.includes('Format as currency with dollar sign'),
            'Should include presenter description for price'
        );
    } finally {
        await cleanupTempDir(tempDir);
    }
});

test('tskillToSpecs: generates resolver specs for fields with resolvers', async () => {
    const tempDir = await createTempSkillDir(SIMPLE_TSKILL);

    try {
        const content = await fs.readFile(path.join(tempDir, 'tskill.md'), 'utf-8');
        const parsedSkill = parseSkillMarkdown(content);

        const specPath = await tskillToSpecs(tempDir, parsedSkill);
        const specContent = await fs.readFile(specPath, 'utf-8');

        assert.ok(
            specContent.includes('## Function: resolver_price(value, record)'),
            'Should include resolver for price field'
        );
        assert.ok(
            specContent.includes('Convert decimal input to cents'),
            'Should include resolver description'
        );
    } finally {
        await cleanupTempDir(tempDir);
    }
});

test('tskillToSpecs: generates enumerator specs for enum fields', async () => {
    const tempDir = await createTempSkillDir(SIMPLE_TSKILL);

    try {
        const content = await fs.readFile(path.join(tempDir, 'tskill.md'), 'utf-8');
        const parsedSkill = parseSkillMarkdown(content);

        const specPath = await tskillToSpecs(tempDir, parsedSkill);
        const specContent = await fs.readFile(specPath, 'utf-8');

        assert.ok(
            specContent.includes('## Function: enumerator_status(context)'),
            'Should include enumerator for status field'
        );
        // The enumerator description mentions returning the array
        assert.ok(
            specContent.includes('active') && specContent.includes('inactive') && specContent.includes('discontinued'),
            'Should include enum values'
        );
    } finally {
        await cleanupTempDir(tempDir);
    }
});

test('tskillToSpecs: generates derivator specs for derived fields', async () => {
    const tempDir = await createTempSkillDir(TSKILL_WITH_DERIVED);

    try {
        const content = await fs.readFile(path.join(tempDir, 'tskill.md'), 'utf-8');
        const parsedSkill = parseSkillMarkdown(content);

        const specPath = await tskillToSpecs(tempDir, parsedSkill);
        const specContent = await fs.readFile(specPath, 'utf-8');

        assert.ok(
            specContent.includes('## Function: derivator_total(record)'),
            'Should include derivator for total field'
        );
        assert.ok(
            specContent.includes('Multiply quantity by unit_price'),
            'Should include derivator description'
        );
    } finally {
        await cleanupTempDir(tempDir);
    }
});

test('tskillToSpecs: generates generatePKValues spec', async () => {
    const tempDir = await createTempSkillDir(SIMPLE_TSKILL);

    try {
        const content = await fs.readFile(path.join(tempDir, 'tskill.md'), 'utf-8');
        const parsedSkill = parseSkillMarkdown(content);

        const specPath = await tskillToSpecs(tempDir, parsedSkill);
        const specContent = await fs.readFile(specPath, 'utf-8');

        assert.ok(
            specContent.includes('## Function: generatePKValues(record, existingRecords)'),
            'Should include generatePKValues function spec'
        );
        assert.ok(
            specContent.includes('**Primary Key Field:**'),
            'Should specify primary key field'
        );
        assert.ok(
            specContent.includes('**Strategy:**'),
            'Should specify PK generation strategy'
        );
    } finally {
        await cleanupTempDir(tempDir);
    }
});

test('tskillToSpecs: generates prepareRecord spec', async () => {
    const tempDir = await createTempSkillDir(SIMPLE_TSKILL);

    try {
        const content = await fs.readFile(path.join(tempDir, 'tskill.md'), 'utf-8');
        const parsedSkill = parseSkillMarkdown(content);

        const specPath = await tskillToSpecs(tempDir, parsedSkill);
        const specContent = await fs.readFile(specPath, 'utf-8');

        assert.ok(
            specContent.includes('## Function: prepareRecord(record, context)'),
            'Should include prepareRecord function spec'
        );
        assert.ok(
            specContent.includes('Transforms a record before database insertion'),
            'Should describe prepareRecord purpose'
        );
        assert.ok(
            specContent.includes('**Async function.**'),
            'Should indicate async nature'
        );
    } finally {
        await cleanupTempDir(tempDir);
    }
});

test('tskillToSpecs: generates validateRecord spec', async () => {
    const tempDir = await createTempSkillDir(SIMPLE_TSKILL);

    try {
        const content = await fs.readFile(path.join(tempDir, 'tskill.md'), 'utf-8');
        const parsedSkill = parseSkillMarkdown(content);

        const specPath = await tskillToSpecs(tempDir, parsedSkill);
        const specContent = await fs.readFile(specPath, 'utf-8');

        assert.ok(
            specContent.includes('## Function: validateRecord(record)'),
            'Should include validateRecord function spec'
        );
        assert.ok(
            specContent.includes('Validates an entire record by running all field validators'),
            'Should describe validateRecord purpose'
        );
        assert.ok(
            specContent.includes('isValid: boolean'),
            'Should describe output shape'
        );
    } finally {
        await cleanupTempDir(tempDir);
    }
});

test('tskillToSpecs: generates presentRecord spec', async () => {
    const tempDir = await createTempSkillDir(SIMPLE_TSKILL);

    try {
        const content = await fs.readFile(path.join(tempDir, 'tskill.md'), 'utf-8');
        const parsedSkill = parseSkillMarkdown(content);

        const specPath = await tskillToSpecs(tempDir, parsedSkill);
        const specContent = await fs.readFile(specPath, 'utf-8');

        assert.ok(
            specContent.includes('## Function: presentRecord(record)'),
            'Should include presentRecord function spec'
        );
        assert.ok(
            specContent.includes('Formats an entire record for display'),
            'Should describe presentRecord purpose'
        );
    } finally {
        await cleanupTempDir(tempDir);
    }
});

test('tskillToSpecs: generates exports structure spec', async () => {
    const tempDir = await createTempSkillDir(SIMPLE_TSKILL);

    try {
        const content = await fs.readFile(path.join(tempDir, 'tskill.md'), 'utf-8');
        const parsedSkill = parseSkillMarkdown(content);

        const specPath = await tskillToSpecs(tempDir, parsedSkill);
        const specContent = await fs.readFile(specPath, 'utf-8');

        assert.ok(
            specContent.includes('## Exports Structure'),
            'Should include exports structure section'
        );
        assert.ok(
            specContent.includes('export const functions = {'),
            'Should show functions export format'
        );
        assert.ok(
            specContent.includes('global: {'),
            'Should show global namespace'
        );
        assert.ok(
            specContent.includes('### Required Exports Summary'),
            'Should include exports summary table'
        );
    } finally {
        await cleanupTempDir(tempDir);
    }
});

test('tskillToSpecs: includes business rules in module description', async () => {
    const tempDir = await createTempSkillDir(SIMPLE_TSKILL);

    try {
        const content = await fs.readFile(path.join(tempDir, 'tskill.md'), 'utf-8');
        const parsedSkill = parseSkillMarkdown(content);

        const specPath = await tskillToSpecs(tempDir, parsedSkill);
        const specContent = await fs.readFile(specPath, 'utf-8');

        assert.ok(
            specContent.includes('**Business Rules:**'),
            'Should include business rules section'
        );
        assert.ok(
            specContent.includes('Product names must be unique'),
            'Should include first business rule'
        );
        assert.ok(
            specContent.includes('Price cannot be negative'),
            'Should include second business rule'
        );
    } finally {
        await cleanupTempDir(tempDir);
    }
});

test('tskillToSpecs: handles minimal skill definition', async () => {
    const tempDir = await createTempSkillDir(MINIMAL_TSKILL);

    try {
        const content = await fs.readFile(path.join(tempDir, 'tskill.md'), 'utf-8');
        const parsedSkill = parseSkillMarkdown(content);

        const specPath = await tskillToSpecs(tempDir, parsedSkill);
        const specContent = await fs.readFile(specPath, 'utf-8');

        // Should still generate basic structure
        assert.ok(
            specContent.includes('# Specification for tskill.generated.mjs - Notes Database Functions'),
            'Should include header'
        );
        assert.ok(
            specContent.includes('## Function: generatePKValues'),
            'Should include generatePKValues even for minimal skill'
        );
        assert.ok(
            specContent.includes('## Function: prepareRecord'),
            'Should include prepareRecord'
        );
        assert.ok(
            specContent.includes('## Function: validateRecord'),
            'Should include validateRecord'
        );
        assert.ok(
            specContent.includes('## Function: presentRecord'),
            'Should include presentRecord'
        );
    } finally {
        await cleanupTempDir(tempDir);
    }
});

// ============================================================================
// parseSkillMarkdown Integration Tests
// ============================================================================

test('parseSkillMarkdown: correctly parses table name', () => {
    const parsed = parseSkillMarkdown(SIMPLE_TSKILL);

    assert.strictEqual(parsed.tableName, 'Products');
});

test('parseSkillMarkdown: correctly parses table purpose', () => {
    const parsed = parseSkillMarkdown(SIMPLE_TSKILL);

    assert.strictEqual(
        parsed.tablePurpose,
        'Manage product inventory for an e-commerce system.'
    );
});

test('parseSkillMarkdown: correctly identifies primary key', () => {
    const parsed = parseSkillMarkdown(SIMPLE_TSKILL);

    assert.strictEqual(parsed.primaryKey, 'product_id');
    assert.ok(parsed.fields.product_id.isPrimaryKey);
});

test('parseSkillMarkdown: correctly identifies required fields', () => {
    const parsed = parseSkillMarkdown(SIMPLE_TSKILL);

    assert.ok(parsed.fields.name.isRequired, 'name should be required');
    assert.ok(parsed.fields.price.isRequired, 'price should be required');
    assert.ok(!parsed.fields.status.isRequired, 'status should not be required');
});

test('parseSkillMarkdown: correctly parses field validators', () => {
    const parsed = parseSkillMarkdown(SIMPLE_TSKILL);

    assert.ok(parsed.fields.name.validatorDescription.includes('2 and 200 characters'));
    assert.ok(parsed.fields.price.validatorDescription.includes('positive integer'));
});

test('parseSkillMarkdown: correctly parses field presenters', () => {
    const parsed = parseSkillMarkdown(SIMPLE_TSKILL);

    assert.ok(parsed.fields.name.valuePresenterDescription.includes('Title Case'));
    assert.ok(parsed.fields.price.valuePresenterDescription.includes('currency'));
});

test('parseSkillMarkdown: correctly parses field resolvers', () => {
    const parsed = parseSkillMarkdown(SIMPLE_TSKILL);

    assert.ok(parsed.fields.price.resolverDescription.includes('cents'));
});

test('parseSkillMarkdown: correctly parses enumerator descriptions', () => {
    const parsed = parseSkillMarkdown(SIMPLE_TSKILL);

    assert.ok(parsed.fields.status.enumeratorDescription);
    // The parser extracts enum values from the description
    assert.ok(
        parsed.fields.status.enumValues?.includes('active') ||
        parsed.fields.status.enumeratorDescription.includes('active')
    );
});

test('parseSkillMarkdown: correctly identifies derived fields', () => {
    const parsed = parseSkillMarkdown(TSKILL_WITH_DERIVED);

    // Derived fields should be moved to derivedFields
    assert.ok(parsed.derivedFields.total, 'total should be in derivedFields');
    assert.ok(!parsed.fields.total, 'total should not be in fields');
    assert.ok(parsed.derivedFields.total.derivatorDescription.includes('Multiply'));
});

test('parseSkillMarkdown: correctly parses business rules', () => {
    const parsed = parseSkillMarkdown(SIMPLE_TSKILL);

    assert.strictEqual(parsed.businessRules.length, 2);
    assert.ok(parsed.businessRules[0].includes('unique'));
    assert.ok(parsed.businessRules[1].includes('negative'));
});

// ============================================================================
// validateSkill Integration Tests
// ============================================================================

test('validateSkill: valid skill passes validation', () => {
    const parsed = parseSkillMarkdown(SIMPLE_TSKILL);
    const validation = validateSkill(parsed);

    assert.ok(validation.isValid, 'Skill should be valid');
    assert.strictEqual(validation.errors.length, 0, 'Should have no errors');
});

test('validateSkill: skill without table name fails', () => {
    const brokenSkill = `## Table Purpose
Some purpose

## Fields

### field1
#### Description
A field`;

    const parsed = parseSkillMarkdown(brokenSkill);
    const validation = validateSkill(parsed);

    assert.ok(!validation.isValid, 'Skill should be invalid');
    assert.ok(
        validation.errors.some(e => e.includes('Table name')),
        'Should report missing table name'
    );
});

test('validateSkill: skill without fields fails', () => {
    const noFieldsSkill = `# Empty Skill

## Table Purpose
A skill with no fields`;

    const parsed = parseSkillMarkdown(noFieldsSkill);
    const validation = validateSkill(parsed);

    assert.ok(!validation.isValid, 'Skill should be invalid');
    assert.ok(
        validation.errors.some(e => e.includes('field')),
        'Should report missing fields'
    );
});

test('validateSkill: warns about missing primary key', () => {
    const noPKSkill = `# NoPK Skill

## Table Purpose
A skill without primary key

## Fields

### name
#### Description
A name field`;

    const parsed = parseSkillMarkdown(noPKSkill);
    const validation = validateSkill(parsed);

    // Should be valid but with warnings
    assert.ok(validation.isValid, 'Skill should still be valid');
    assert.ok(
        validation.warnings.some(w => w.includes('primary key')),
        'Should warn about missing primary key'
    );
});

// ============================================================================
// End-to-End Flow Test
// ============================================================================

test('E2E: full tskill -> parse -> validate -> specs flow', async () => {
    const tempDir = await createTempSkillDir(SIMPLE_TSKILL);

    try {
        // Step 1: Read tskill.md
        const content = await fs.readFile(path.join(tempDir, 'tskill.md'), 'utf-8');

        // Step 2: Parse
        const parsedSkill = parseSkillMarkdown(content);
        assert.strictEqual(parsedSkill.tableName, 'Products');

        // Step 3: Validate
        const validation = validateSkill(parsedSkill);
        assert.ok(validation.isValid);

        // Step 4: Generate specs
        const specPath = await tskillToSpecs(tempDir, parsedSkill);

        // Step 5: Verify spec file
        const specContent = await fs.readFile(specPath, 'utf-8');

        // Verify all expected sections are present
        const expectedSections = [
            '# Specification for tskill.generated.mjs',
            '## Module Description',
            '## Dependencies',
            '## Function: validator_name',
            '## Function: validator_price',
            '## Function: validator_status',
            '## Function: presenter_name',
            '## Function: presenter_price',
            '## Function: resolver_price',
            '## Function: enumerator_status',
            '## Function: generatePKValues',
            '## Function: prepareRecord',
            '## Function: validateRecord',
            '## Function: presentRecord',
            '## Exports Structure',
        ];

        for (const section of expectedSections) {
            assert.ok(
                specContent.includes(section),
                `Spec should include: ${section}`
            );
        }
    } finally {
        await cleanupTempDir(tempDir);
    }
});

test('E2E: real customers fixture produces valid spec', async () => {
    // Use the actual fixture from the test directory
    const fixtureDir = path.join(
        import.meta.dirname,
        '.AchillesSkills/customers'
    );

    try {
        const tskillPath = path.join(fixtureDir, 'tskill.md');
        const content = await fs.readFile(tskillPath, 'utf-8');

        const parsedSkill = parseSkillMarkdown(content);
        const validation = validateSkill(parsedSkill);

        assert.ok(validation.isValid, 'Customers fixture should be valid');
        assert.strictEqual(parsedSkill.tableName, 'Customers');

        // Create a temp copy to avoid modifying the fixture
        const tempDir = await createTempSkillDir(content);

        try {
            const specPath = await tskillToSpecs(tempDir, parsedSkill);
            const specContent = await fs.readFile(specPath, 'utf-8');

            // Verify customers-specific content
            assert.ok(specContent.includes('validator_email'));
            assert.ok(specContent.includes('validator_name'));
            assert.ok(specContent.includes('presenter_status'));
            assert.ok(specContent.includes('derivator_display_name'));
        } finally {
            await cleanupTempDir(tempDir);
        }
    } catch (err) {
        // If fixture doesn't exist, skip gracefully
        if (err.code === 'ENOENT') {
            console.log('Skipping customers fixture test - fixture not found');
            return;
        }
        throw err;
    }
});

console.log('tskillToSpecs integration tests completed');
