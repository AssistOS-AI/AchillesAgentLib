/**
 * tskillToSpecs - Generates mirror-code-generator compatible specs from tskill.md.
 *
 * This module parses a tskill.md definition and generates a spec file that
 * mirror-code-generator can use to produce the tskill.generated.mjs code.
 *
 * Flow:
 *   tskill.md → parseSkillMarkdown() → tskillToSpecs() → specs/tskill.generated.mjs.md
 *                                                                  ↓
 *                                                    mirror-code-generator
 *                                                                  ↓
 *                                                    tskill.generated.mjs
 */

import fs from 'node:fs/promises';
import path from 'node:path';

const DEBUG_ENABLED = String(process.env.ACHILLES_DEBUG ?? '').toLowerCase() === 'true';

function debugLog(...args) {
    if (DEBUG_ENABLED) console.log(...args);
}

/**
 * Generate a spec file from a parsed tskill definition.
 * @param {string} skillDir - Directory containing tskill.md
 * @param {Object} parsedSkill - Parsed skill object from SkillParser
 * @returns {Promise<string>} Path to the generated spec file
 */
export async function tskillToSpecs(skillDir, parsedSkill) {
    const specsDir = path.join(skillDir, 'specs');
    const specPath = path.join(specsDir, 'tskill.generated.mjs.md');

    debugLog(`[DBTableSkills] Generating spec for "${parsedSkill.tableName}" → ${specPath}`);

    // Ensure specs directory exists
    await fs.mkdir(specsDir, { recursive: true });

    // Generate the spec content
    const specContent = generateSpecContent(parsedSkill);

    // Write the spec file
    await fs.writeFile(specPath, specContent, 'utf-8');

    const fieldCount = Object.keys(parsedSkill.fields || {}).length;
    const derivedCount = Object.keys(parsedSkill.derivedFields || {}).length;
    debugLog(`[DBTableSkills] Spec generated: ${fieldCount} fields, ${derivedCount} derived fields`);

    return specPath;
}

/**
 * Generate the full spec markdown content.
 * @param {Object} skill - Parsed skill object
 * @returns {string} Spec markdown content
 */
function generateSpecContent(skill) {
    const sections = [];

    // Header
    sections.push(generateHeader(skill));

    // Module description
    sections.push(generateModuleDescription(skill));

    // Dependencies section
    sections.push(generateDependencies());

    // Field validators
    for (const [fieldName, field] of Object.entries(skill.fields)) {
        if (field.validatorDescription || field.isRequired) {
            sections.push(generateValidatorSpec(fieldName, field, skill));
        }
    }

    // Field presenters
    for (const [fieldName, field] of Object.entries(skill.fields)) {
        if (field.valuePresenterDescription) {
            sections.push(generatePresenterSpec(fieldName, field));
        }
    }

    // Field resolvers
    for (const [fieldName, field] of Object.entries(skill.fields)) {
        if (field.resolverDescription) {
            sections.push(generateResolverSpec(fieldName, field));
        }
    }

    // Field enumerators
    for (const [fieldName, field] of Object.entries(skill.fields)) {
        if (field.enumeratorDescription || field.enumValues) {
            sections.push(generateEnumeratorSpec(fieldName, field));
        }
    }

    // Derivators (from derivedFields)
    for (const [fieldName, field] of Object.entries(skill.derivedFields || {})) {
        sections.push(generateDerivatorSpec(fieldName, field));
    }

    // Global functions
    sections.push(generatePKValuesSpec(skill));
    sections.push(generatePrepareRecordSpec(skill));
    sections.push(generateValidateRecordSpec(skill));
    sections.push(generatePresentRecordSpec(skill));

    // Export structure
    sections.push(generateExportsSpec(skill));

    return sections.join('\n\n---\n\n');
}

/**
 * Generate spec header.
 */
function generateHeader(skill) {
    return `# Specification for tskill.generated.mjs - ${skill.tableName} Database Functions`;
}

/**
 * Generate module description section.
 */
function generateModuleDescription(skill) {
    const fieldNames = Object.keys(skill.fields);
    const derivedFieldNames = Object.keys(skill.derivedFields || {});

    return `## Module Description

Generated functions for the **${skill.tableName}** database table skill.

**Table Purpose:** ${skill.tablePurpose || 'Not specified'}

**Fields:** ${fieldNames.join(', ') || 'None'}
${derivedFieldNames.length > 0 ? `**Derived Fields:** ${derivedFieldNames.join(', ')}` : ''}

This module provides:
- Field validators (validator_<fieldName>) for data validation
- Field presenters (presenter_<fieldName>) for display formatting
- Field resolvers (resolver_<fieldName>) for input parsing
- Field enumerators (enumerator_<fieldName>) for allowed values
- Record-level functions for CRUD operations

**Business Rules:**
${skill.businessRules?.length > 0 ? skill.businessRules.map(r => `- ${r}`).join('\n') : '- None specified'}`;
}

/**
 * Generate dependencies section.
 */
function generateDependencies() {
    return `## Dependencies

None (pure JavaScript/ESM implementation).`;
}

/**
 * Generate validator function spec.
 */
function generateValidatorSpec(fieldName, field, skill) {
    const requiredCheck = field.isRequired
        ? `1. If value is null, undefined, or empty string and field is required, return error JSON`
        : `1. If value is null or undefined, return empty string (field is optional)`;

    let validationLogic = '';
    if (field.validatorDescription) {
        validationLogic = `2. Validate: ${field.validatorDescription}`;
    } else if (field.type === 'email') {
        validationLogic = `2. Validate that value is a valid email format (contains @ and domain)`;
    } else if (field.type === 'integer') {
        validationLogic = `2. Validate that value is a valid integer`;
    } else if (field.type === 'decimal') {
        validationLogic = `2. Validate that value is a valid number`;
    } else if (field.type === 'boolean') {
        validationLogic = `2. Validate that value is a boolean or can be coerced to boolean`;
    } else if (field.type === 'date' || field.type === 'datetime') {
        validationLogic = `2. Validate that value is a valid date/datetime`;
    } else if (field.pattern) {
        validationLogic = `2. Validate that value matches pattern: ${field.pattern}`;
    } else if (field.maxLength || field.minLength) {
        const constraints = [];
        if (field.minLength) constraints.push(`minimum length ${field.minLength}`);
        if (field.maxLength) constraints.push(`maximum length ${field.maxLength}`);
        validationLogic = `2. Validate length constraints: ${constraints.join(', ')}`;
    } else {
        validationLogic = `2. Perform basic type validation for ${field.type || 'string'}`;
    }

    return `## Function: validator_${fieldName}(value, record)

### Description
Validates the **${fieldName}** field.${field.description ? ` ${field.description}` : ''}
${field.isRequired ? '**This field is required.**' : ''}

### Input
- \`value\` (any): The ${fieldName} value to validate
- \`record\` (object): The full record object for cross-field validation

### Processing Logic
${requiredCheck}
${validationLogic}
3. If validation fails, return \`JSON.stringify({field: '${fieldName}', error: '<error message>', value: value})\`
4. If validation passes, return empty string \`''\`

### Output
- **Invalid:** \`'{"field":"${fieldName}","error":"<description>","value":"<value>"}'\`
- **Valid:** \`''\` (empty string)

### CRITICAL
- Return type is STRING, not object
- Empty string means valid
- Non-empty string (JSON) means invalid`;
}

/**
 * Generate presenter function spec.
 */
function generatePresenterSpec(fieldName, field) {
    return `## Function: presenter_${fieldName}(value, record)

### Description
Formats the **${fieldName}** field for display.
${field.valuePresenterDescription ? `**Format:** ${field.valuePresenterDescription}` : ''}

### Input
- \`value\` (any): The raw database value
- \`record\` (object): The full record object for context

### Processing Logic
1. If value is null or undefined, return \`'—'\` (em dash)
2. ${field.valuePresenterDescription || `Convert ${field.type || 'string'} value to display string`}
3. Return the formatted string

### Output
Formatted display string suitable for user interface.`;
}

/**
 * Generate resolver function spec.
 */
function generateResolverSpec(fieldName, field) {
    return `## Function: resolver_${fieldName}(value, record)

### Description
Resolves user input for the **${fieldName}** field into database format.
${field.resolverDescription ? `**Resolution:** ${field.resolverDescription}` : ''}

### Input
- \`value\` (any): The user-provided input value
- \`record\` (object): The current record object for context

### Processing Logic
1. If value is null or undefined, return null
2. ${field.resolverDescription || `Parse and convert user input to ${field.type || 'string'} format`}
3. Return the resolved value suitable for database storage

### Output
Value in database-compatible format (${field.type || 'string'}).`;
}

/**
 * Generate enumerator function spec.
 */
function generateEnumeratorSpec(fieldName, field) {
    const enumList = field.enumValues
        ? `**Known Values:** ${field.enumValues.map(v => `\`${v}\``).join(', ')}`
        : '';

    return `## Function: enumerator_${fieldName}(context)

### Description
Returns the allowed values for the **${fieldName}** field.
${field.enumeratorDescription ? `**Logic:** ${field.enumeratorDescription}` : ''}
${enumList}

### Input
- \`context\` (object, optional): Execution context with potential filters or constraints

### Processing Logic
1. ${field.enumValues ? `Return the predefined list of allowed values` : field.enumeratorDescription || 'Determine allowed values based on context'}
2. Return as array of valid options

### Output
Array of allowed values: \`${field.enumValues ? JSON.stringify(field.enumValues) : "['value1', 'value2', ...]"}\``;
}

/**
 * Generate derivator function spec.
 */
function generateDerivatorSpec(fieldName, field) {
    return `## Function: derivator_${fieldName}(record)

### Description
Computes the derived value for the **${fieldName}** field.
${field.derivatorDescription ? `**Computation:** ${field.derivatorDescription}` : ''}

### Input
- \`record\` (object): The full record object with source fields

### Processing Logic
1. ${field.derivatorDescription || 'Compute the derived value from other fields'}
2. Return the computed value

### Output
Computed value for the ${fieldName} field.`;
}

/**
 * Generate generatePKValues function spec.
 */
function generatePKValuesSpec(skill) {
    const pkField = skill.primaryKey;
    const pkStrategy = pkField && skill.fields[pkField]?.primaryKeyStrategy
        ? skill.fields[pkField].primaryKeyStrategy
        : 'uuid';

    return `## Function: generatePKValues(record, existingRecords)

### Description
Generates primary key values for new records.
**Primary Key Field:** \`${pkField || skill.tableName + '_id'}\`
**Strategy:** ${pkStrategy}

### Input
- \`record\` (object): The record being created (may already have some fields)
- \`existingRecords\` (array, optional): Existing records for uniqueness checking

### Processing Logic
1. Check if primary key already exists in record
2. If not, generate using ${pkStrategy === 'auto-increment' ? 'auto-increment (find max + 1)' : pkStrategy === 'uuid' ? 'crypto.randomUUID()' : pkStrategy}
3. Return object with the primary key field

### Output
\`{ ${pkField || skill.tableName + '_id'}: '<generated-value>' }\`

### Implementation Note
For UUID strategy, use:
\`\`\`javascript
import crypto from 'node:crypto';
// ...
return { ${pkField || skill.tableName + '_id'}: crypto.randomUUID() };
\`\`\``;
}

/**
 * Generate prepareRecord function spec.
 */
function generatePrepareRecordSpec(skill) {
    const resolverFields = Object.entries(skill.fields)
        .filter(([, f]) => f.resolverDescription)
        .map(([name]) => name);

    const derivedFields = Object.keys(skill.derivedFields || {});

    return `## Function: prepareRecord(record, context)

### Description
Transforms a record before database insertion. **Async function.**

### Input
- \`record\` (object): The raw record data from user input
- \`context\` (object, optional): Execution context

### Processing Logic
1. Create a copy of the input record
2. Call resolver functions for fields that have them:
${resolverFields.length > 0 ? resolverFields.map(f => `   - resolver_${f}`).join('\n') : '   - (no resolver functions defined)'}
3. Call derivator functions for derived fields:
${derivedFields.length > 0 ? derivedFields.map(f => `   - derivator_${f}`).join('\n') : '   - (no derivator functions defined)'}
4. Apply any default values for missing fields
5. Return the transformed record

### Output
Record object ready for database insertion with all transformations applied.`;
}

/**
 * Generate validateRecord function spec.
 */
function generateValidateRecordSpec(skill) {
    const validatorFields = Object.entries(skill.fields)
        .filter(([, f]) => f.validatorDescription || f.isRequired)
        .map(([name]) => name);

    return `## Function: validateRecord(record)

### Description
Validates an entire record by running all field validators.

### Input
- \`record\` (object): The record to validate

### Processing Logic
1. Initialize errors array
2. Call each validator function:
${validatorFields.length > 0 ? validatorFields.map(f => `   - validator_${f}(record.${f}, record)`).join('\n') : '   - (no validators defined)'}
3. Collect any non-empty error strings (parse JSON to extract error details)
4. Return validation result

### Output
\`\`\`javascript
{
    isValid: boolean,  // true if no errors
    errors: [          // array of error objects
        { field: 'fieldName', error: 'message', value: 'badValue' },
        // ...
    ]
}
\`\`\`

### Implementation Pattern
\`\`\`javascript
async function validateRecord(record) {
    const errors = [];
    
    // Call each validator
    const validators = [
${validatorFields.map(f => `        ['${f}', validator_${f}],`).join('\n')}
    ];
    
    for (const [fieldName, validatorFn] of validators) {
        const result = validatorFn(record[fieldName], record);
        if (result) {
            try {
                errors.push(JSON.parse(result));
            } catch {
                errors.push({ field: fieldName, error: result, value: record[fieldName] });
            }
        }
    }
    
    return { isValid: errors.length === 0, errors };
}
\`\`\``;
}

/**
 * Generate presentRecord function spec.
 */
function generatePresentRecordSpec(skill) {
    const presenterFields = Object.entries(skill.fields)
        .filter(([, f]) => f.valuePresenterDescription)
        .map(([name]) => name);

    return `## Function: presentRecord(record)

### Description
Formats an entire record for display by calling all presenter functions. **Async function.**

### Input
- \`record\` (object): The raw database record

### Processing Logic
1. Create a copy of the input record
2. For each field with a presenter function, call it:
${presenterFields.length > 0 ? presenterFields.map(f => `   - presenter_${f}(record.${f}, record) → formatted value`).join('\n') : '   - (no presenter functions defined)'}
3. Return the formatted record

### Output
Record object with all fields formatted for display.

### Implementation Pattern
\`\`\`javascript
async function presentRecord(record) {
    if (!record) return record;
    const presented = { ...record };
    
${presenterFields.map(f => `    if (record.${f} !== undefined) {
        presented.${f} = presenter_${f}(record.${f}, record);
    }`).join('\n')}
    
    return presented;
}
\`\`\``;
}

/**
 * Generate exports structure spec.
 */
function generateExportsSpec(skill) {
    const allFunctions = [];

    // Validators
    for (const [fieldName, field] of Object.entries(skill.fields)) {
        if (field.validatorDescription || field.isRequired) {
            allFunctions.push(`validator_${fieldName}`);
        }
    }

    // Presenters
    for (const [fieldName, field] of Object.entries(skill.fields)) {
        if (field.valuePresenterDescription) {
            allFunctions.push(`presenter_${fieldName}`);
        }
    }

    // Resolvers
    for (const [fieldName, field] of Object.entries(skill.fields)) {
        if (field.resolverDescription) {
            allFunctions.push(`resolver_${fieldName}`);
        }
    }

    // Enumerators
    for (const [fieldName, field] of Object.entries(skill.fields)) {
        if (field.enumeratorDescription || field.enumValues) {
            allFunctions.push(`enumerator_${fieldName}`);
        }
    }

    // Derivators
    for (const fieldName of Object.keys(skill.derivedFields || {})) {
        allFunctions.push(`derivator_${fieldName}`);
    }

    // Global functions
    allFunctions.push('generatePKValues', 'prepareRecord', 'validateRecord', 'presentRecord');

    return `## Exports Structure

The module **MUST** export a \`functions\` object with all functions under the \`global\` key:

\`\`\`javascript
// All individual function exports
export { ${allFunctions.slice(0, 5).join(', ')}${allFunctions.length > 5 ? ', ...' : ''} };

// Main functions export object
export const functions = {
    global: {
${allFunctions.map(f => `        ${f},`).join('\n')}
    }
};
\`\`\`

### Required Exports Summary
| Category | Functions |
|----------|-----------|
| Validators | ${allFunctions.filter(f => f.startsWith('validator_')).join(', ') || 'None'} |
| Presenters | ${allFunctions.filter(f => f.startsWith('presenter_')).join(', ') || 'None'} |
| Resolvers | ${allFunctions.filter(f => f.startsWith('resolver_')).join(', ') || 'None'} |
| Enumerators | ${allFunctions.filter(f => f.startsWith('enumerator_')).join(', ') || 'None'} |
| Derivators | ${allFunctions.filter(f => f.startsWith('derivator_')).join(', ') || 'None'} |
| Global | generatePKValues, prepareRecord, validateRecord, presentRecord |`;
}

export default tskillToSpecs;
