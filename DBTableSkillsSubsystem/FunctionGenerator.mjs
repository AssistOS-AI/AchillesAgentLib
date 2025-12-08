/**
 * FunctionGenerator - Utility module for generating JavaScript functions from skill definitions
 */

/**
 * Generate a presenter function for a field
 */
export async function generatePresenterFunction(fieldName, fieldDef, llmAgent, context = {}) {
    const baseFunction = `function presenter_${fieldName}(value, record) {
    if (value === null || value === undefined) return '';
    // ${fieldDef.valuePresenterDescription || 'Present value in human-readable format'}
    return String(value);
}`;

    if (!llmAgent || typeof llmAgent.executePrompt !== 'function') {
        return baseFunction;
    }

    try {
        let prompt = `Generate a JavaScript function named "presenter_${fieldName}" that presents the value of field "${fieldName}".
Description: ${fieldDef.valuePresenterDescription}
The function should take (value, record) as parameters and return a human-readable string.

Requirements:
- Handle null/undefined values gracefully
- Return a string representation
- The record parameter contains the entire database record for context

Return only the function code without any explanation or markdown formatting.`;

        if (context.oldCode) {
            prompt += `\n\nPrevious implementation:\n${context.oldCode}`;
        }
        if (context.oldTskill) {
            prompt += `\n\nPrevious Skill Definition:\n${context.oldTskill}`;
        }
        if (context.newTskill) {
            prompt += `\n\nNew Skill Definition:\n${context.newTskill}`;
        }

        const result = await llmAgent.executePrompt(prompt, {
            mode: 'fast',
            responseShape: 'code'
        });

        return cleanGeneratedCode(result) || baseFunction;
    } catch (error) {
        console.error(`Error generating presenter for ${fieldName}:`, error);
        return baseFunction;
    }
}

/**
 * Generate a resolver function for a field
 */
export async function generateResolverFunction(fieldName, fieldDef, llmAgent, context = {}) {
    const baseFunction = `function resolver_${fieldName}(humanValue, record) {
    if (humanValue === null || humanValue === undefined) return null;
    // ${fieldDef.resolverDescription || 'Resolve human input to database format'}
    return humanValue;
}`;

    if (!llmAgent || typeof llmAgent.executePrompt !== 'function') {
        return baseFunction;
    }

    try {
        let prompt = `Generate a JavaScript function named "resolver_${fieldName}" that resolves human input to database format for field "${fieldName}".
Description: ${fieldDef.resolverDescription}
The function should take (humanValue, record) as parameters and return the database value.

Requirements:
- Convert human-readable input to database format
- Handle null/undefined values appropriately
- The record parameter contains the entire database record for context
- Should be symmetric with the presenter function (reverse operation)

Return only the function code without any explanation or markdown formatting.`;

        if (context.oldCode) {
            prompt += `\n\nPrevious implementation:\n${context.oldCode}`;
        }
        if (context.oldTskill) {
            prompt += `\n\nPrevious Skill Definition:\n${context.oldTskill}`;
        }
        if (context.newTskill) {
            prompt += `\n\nNew Skill Definition:\n${context.newTskill}`;
        }

        const result = await llmAgent.executePrompt(prompt, {
            mode: 'fast',
            responseShape: 'code'
        });

        return cleanGeneratedCode(result) || baseFunction;
    } catch (error) {
        console.error(`Error generating resolver for ${fieldName}:`, error);
        return baseFunction;
    }
}

/**
 * Generate a validator function for a field
 */
export async function generateValidatorFunction(fieldName, fieldDef, llmAgent, context = {}) {
    const baseFunction = `function validator_${fieldName}(value, record) {
    ${fieldDef.isRequired ? `
    // Check if field is required
    if (value === null || value === undefined || value === '') {
        return JSON.stringify({
            field: '${fieldName}',
            error: 'Field is required${fieldDef.requiredCondition ? ': ' + fieldDef.requiredCondition : ''}',
            value: value
        });
    }` : ''}

    // ${fieldDef.validatorDescription || 'No specific validation rules'}

    return ''; // Return empty string if valid
}`;

    if (!llmAgent || typeof llmAgent.executePrompt !== 'function') {
        return baseFunction;
    }

    try {
        let prompt = `Generate a JavaScript function named "validator_${fieldName}" that validates the value of field "${fieldName}".
Description: ${fieldDef.validatorDescription || 'Standard validation'}
Required: ${fieldDef.isRequired ? 'Yes - ' + (fieldDef.requiredCondition || 'always required') : 'No'}

The function should:
- Take (value, record) as parameters
- Return an empty string if valid
- Return a JSON string with error details if invalid: JSON.stringify({field, error, value})

Return only the function code without any explanation or markdown formatting.`;

        if (context.oldCode) {
            prompt += `\n\nPrevious implementation:\n${context.oldCode}`;
        }
        if (context.oldTskill) {
            prompt += `\n\nPrevious Skill Definition:\n${context.oldTskill}`;
        }
        if (context.newTskill) {
            prompt += `\n\nNew Skill Definition:\n${context.newTskill}`;
        }

        const result = await llmAgent.executePrompt(prompt, {
            mode: 'fast',
            responseShape: 'code'
        });

        return cleanGeneratedCode(result) || baseFunction;
    } catch (error) {
        console.error(`Error generating validator for ${fieldName}:`, error);
        return baseFunction;
    }
}

/**
 * Generate an enumerator function for a field
 */
export async function generateEnumeratorFunction(fieldName, fieldDef, llmAgent, context = {}) {
    const baseFunction = `function enumerator_${fieldName}(currentRecord) {
    // ${fieldDef.enumeratorDescription || 'Return possible values for this field'}
    return [];
}`;

    if (!llmAgent || typeof llmAgent.executePrompt !== 'function') {
        return baseFunction;
    }

    try {
        let prompt = `Generate a JavaScript function named "enumerator_${fieldName}" that enumerates possible values for field "${fieldName}".
Description: ${fieldDef.enumeratorDescription}

The function should:
- Take (currentRecord) as parameter
- Return an array of valid string options
- Consider the current record context to provide relevant options

Return only the function code without any explanation or markdown formatting.`;

        if (context.oldCode) {
            prompt += `\n\nPrevious implementation:\n${context.oldCode}`;
        }
        if (context.oldTskill) {
            prompt += `\n\nPrevious Skill Definition:\n${context.oldTskill}`;
        }
        if (context.newTskill) {
            prompt += `\n\nNew Skill Definition:\n${context.newTskill}`;
        }

        const result = await llmAgent.executePrompt(prompt, {
            mode: 'fast',
            responseShape: 'code'
        });

        return cleanGeneratedCode(result) || baseFunction;
    } catch (error) {
        console.error(`Error generating enumerator for ${fieldName}:`, error);
        return baseFunction;
    }
}

/**
 * Generate a derivator function for a derived/computed field
 */
export async function generateDerivatorFunction(fieldName, fieldDef, llmAgent, context = {}) {
    const baseFunction = `function derivator_${fieldName}(record) {
    // ${fieldDef.derivatorDescription || 'Compute derived field value'}
    return null;
}`;

    if (!llmAgent || typeof llmAgent.executePrompt !== 'function') {
        return baseFunction;
    }

    try {
        let prompt = `Generate a JavaScript function named "derivator_${fieldName}" that derives a computed value for field "${fieldName}".
Description: ${fieldDef.derivatorDescription}

The function should:
- Take (record) as parameter
- Return the computed/derived value based on other fields
- This is for a "fake" field not stored in the database

Return only the function code without any explanation or markdown formatting.`;

        if (context.oldCode) {
            prompt += `\n\nPrevious implementation:\n${context.oldCode}`;
        }
        if (context.oldTskill) {
            prompt += `\n\nPrevious Skill Definition:\n${context.oldTskill}`;
        }
        if (context.newTskill) {
            prompt += `\n\nNew Skill Definition:\n${context.newTskill}`;
        }

        const result = await llmAgent.executePrompt(prompt, {
            mode: 'fast',
            responseShape: 'code'
        });

        return cleanGeneratedCode(result) || baseFunction;
    } catch (error) {
        console.error(`Error generating derivator for ${fieldName}:`, error);
        return baseFunction;
    }
}

/**
 * Generate field name presenter function
 */
export async function generateFieldNamePresenterFunction(fieldName, fieldDef, llmAgent, context = {}) {
    const baseFunction = `function fieldNamePresenter_${fieldName}() {
    // ${fieldDef.presenterDescription || 'Return human-readable field label'}
    return '${fieldName.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}';
}`;

    if (!llmAgent || typeof llmAgent.executePrompt !== 'function') {
        return baseFunction;
    }

    try {
        let prompt = `Generate a JavaScript function named "fieldNamePresenter_${fieldName}" that returns a human-readable label for field "${fieldName}".
Description: ${fieldDef.presenterDescription}

The function should:
- Take no parameters
- Return a human-readable string label for the field
- Example: "customer_id" -> "Customer ID"

Return only the function code without any explanation or markdown formatting.`;

        if (context.oldCode) {
            prompt += `\n\nPrevious implementation:\n${context.oldCode}`;
        }
        if (context.oldTskill) {
            prompt += `\n\nPrevious Skill Definition:\n${context.oldTskill}`;
        }
        if (context.newTskill) {
            prompt += `\n\nNew Skill Definition:\n${context.newTskill}`;
        }

        const result = await llmAgent.executePrompt(prompt, {
            mode: 'fast',
            responseShape: 'code'
        });

        return cleanGeneratedCode(result) || baseFunction;
    } catch (error) {
        console.error(`Error generating field name presenter for ${fieldName}:`, error);
        return baseFunction;
    }
}

/**
 * Clean generated code by removing markdown formatting and extra content
 */
function cleanGeneratedCode(code) {
    if (!code || typeof code !== 'string') {
        return null;
    }

    // Remove markdown code blocks
    let cleaned = code.trim();
    cleaned = cleaned.replace(/^```(?:javascript|js)?\n?/i, '');
    cleaned = cleaned.replace(/\n?```$/i, '');

    // Remove any leading/trailing whitespace
    cleaned = cleaned.trim();

    // Validate that it looks like a function
    if (!cleaned.includes('function') || !cleaned.includes('(')) {
        return null;
    }

    return cleaned;
}

/**
 * Generate all global functions for a table
 */
export function generateGlobalFunctions(tableName, skill) {
    const functions = {};

    // selectRecords function
    functions.selectRecords = `async function selectRecords(filter) {
    // Apply filter criteria to select records from ${tableName}
    // Filter format: { field: value } or { field: { operator: value } }

    // Placeholder implementation - should integrate with database adapter
    const records = [];

    // Apply filter logic here
    if (filter && typeof filter === 'object') {
        // Filter records based on criteria
    }

    return records;
}`;

    // prepareRecord function
    functions.prepareRecord = `async function prepareRecord(record) {
    const prepared = { ...record };

    // Remove derived/computed fields (they're not stored in DB)
    ${Object.entries(skill.fields)
            .filter(([_, f]) => f.derivatorDescription)
            .map(([fieldName]) => `delete prepared.${fieldName};`)
            .join('\n    ') || '// No derived fields to remove'}

    // Apply resolvers to convert human input to database format
    ${Object.entries(skill.fields)
            .filter(([_, f]) => f.resolverDescription)
            .map(([fieldName]) => `if (prepared.${fieldName} !== undefined) {
        prepared.${fieldName} = await resolver_${fieldName}(prepared.${fieldName}, record);
    }`)
            .join('\n    ') || '// No resolvers to apply'}

    return prepared;
}`;

    // validateRecord function
    functions.validateRecord = `async function validateRecord(record) {
    const errors = [];

    // Run validators for each field
    ${Object.entries(skill.fields)
            .filter(([_, f]) => f.validatorDescription || f.isRequired)
            .map(([fieldName]) => `const ${fieldName}Error = await validator_${fieldName}(record.${fieldName}, record);
    if (${fieldName}Error) {
        try {
            errors.push(JSON.parse(${fieldName}Error));
        } catch (e) {
            errors.push({
                field: '${fieldName}',
                error: ${fieldName}Error,
                value: record.${fieldName}
            });
        }
    }`)
            .join('\n    ') || '// No validators to run'}

    return {
        isValid: errors.length === 0,
        errors: errors
    };
}`;

    // presentRecord function
    functions.presentRecord = `async function presentRecord(record) {
    const presented = { ...record };

    // Apply presenters to format values for display
    ${Object.entries(skill.fields)
            .filter(([_, f]) => f.valuePresenterDescription)
            .map(([fieldName]) => `if (presented.${fieldName} !== undefined) {
        presented.${fieldName} = await presenter_${fieldName}(presented.${fieldName}, record);
    }`)
            .join('\n    ') || '// No presenters to apply'}

    // Add derived/computed fields
    ${Object.entries(skill.fields)
            .filter(([_, f]) => f.derivatorDescription)
            .map(([fieldName]) => `presented.${fieldName} = await derivator_${fieldName}(record);`)
            .join('\n    ') || '// No derived fields to add'}

    return presented;
}`;

    // generatePKValues function (if table has primary key)
    if (skill.primaryKey) {
        const pkField = skill.fields[skill.primaryKey];
        functions.generatePKValues = `function generatePKValues(record) {
    // Generate primary key for field: ${skill.primaryKey}
    ${pkField?.primaryKeyStrategy ? `// Strategy: ${pkField.primaryKeyStrategy}` : ''}

    const pkValue = {
        ${skill.primaryKey}: null
    };

    ${pkField?.primaryKeyStrategy?.toLowerCase().includes('auto') ? `// Auto-increment logic
    // This should query the database for the next available ID
    pkValue.${skill.primaryKey} = Date.now(); // Placeholder - use proper auto-increment` :
                pkField?.primaryKeyStrategy?.toLowerCase().includes('uuid') ? `// UUID generation
    pkValue.${skill.primaryKey} = crypto.randomUUID();` :
                    `// Custom primary key generation
    pkValue.${skill.primaryKey} = Date.now(); // Placeholder`}

    return pkValue;
}`;
    }

    return functions;
}

/**
 * Generate all functions for a table
 */
export async function generateAllFunctions(tableName, skill, llmAgent, context = {}) {
    const functions = {
        presenters: {},
        resolvers: {},
        validators: {},
        enumerators: {},
        derivators: {},
        fieldNamePresenters: {},
        global: {}
    };

    // Generate field-specific functions
    for (const [fieldName, fieldDef] of Object.entries(skill.fields)) {
        const fieldContext = {
            ...context,
            oldCode: context.oldFunctions?.fieldNamePresenters?.[`fieldNamePresenter_${fieldName}`] ||
                context.oldFunctions?.presenters?.[`presenter_${fieldName}`] ||
                context.oldFunctions?.resolvers?.[`resolver_${fieldName}`] ||
                context.oldFunctions?.validators?.[`validator_${fieldName}`] ||
                context.oldFunctions?.enumerators?.[`enumerator_${fieldName}`] ||
                context.oldFunctions?.derivators?.[`derivator_${fieldName}`]
        };

        // Generate field name presenter
        if (fieldDef.presenterDescription) {
            functions.fieldNamePresenters[`fieldNamePresenter_${fieldName}`] =
                await generateFieldNamePresenterFunction(fieldName, fieldDef, llmAgent, {
                    ...context,
                    oldCode: context.oldFunctions?.fieldNamePresenters?.[`fieldNamePresenter_${fieldName}`]
                });
        }

        // Generate value presenter
        if (fieldDef.valuePresenterDescription) {
            functions.presenters[`presenter_${fieldName}`] =
                await generatePresenterFunction(fieldName, fieldDef, llmAgent, {
                    ...context,
                    oldCode: context.oldFunctions?.presenters?.[`presenter_${fieldName}`]
                });
        }

        // Generate resolver
        if (fieldDef.resolverDescription) {
            functions.resolvers[`resolver_${fieldName}`] =
                await generateResolverFunction(fieldName, fieldDef, llmAgent, {
                    ...context,
                    oldCode: context.oldFunctions?.resolvers?.[`resolver_${fieldName}`]
                });
        }

        // Generate validator
        if (fieldDef.validatorDescription || fieldDef.isRequired) {
            functions.validators[`validator_${fieldName}`] =
                await generateValidatorFunction(fieldName, fieldDef, llmAgent, {
                    ...context,
                    oldCode: context.oldFunctions?.validators?.[`validator_${fieldName}`]
                });
        }

        // Generate enumerator
        if (fieldDef.enumeratorDescription) {
            functions.enumerators[`enumerator_${fieldName}`] =
                await generateEnumeratorFunction(fieldName, fieldDef, llmAgent, {
                    ...context,
                    oldCode: context.oldFunctions?.enumerators?.[`enumerator_${fieldName}`]
                });
        }

        // Generate derivator
        if (fieldDef.derivatorDescription) {
            functions.derivators[`derivator_${fieldName}`] =
                await generateDerivatorFunction(fieldName, fieldDef, llmAgent, {
                    ...context,
                    oldCode: context.oldFunctions?.derivators?.[`derivator_${fieldName}`]
                });
        }
    }

    // Generate global functions
    functions.global = generateGlobalFunctions(tableName, skill);

    return functions;
}

/**
 * Serialize functions object to a JavaScript module string
 * @param {Object} functions - The functions object to serialize
 * @param {string} [tskillSource] - Optional: tskill.md content (deprecated, no longer needed for regeneration)
 */
export function serializeFunctions(functions, tskillSource) {
    const lines = [];
    // tskillSource is no longer needed - regeneration now uses file timestamps
    // Keeping parameter for backwards compatibility but not including in output
    lines.push('// Generated by DBTableSkillsSubsystem - regenerate with /generate command or touch tskill.md');
    lines.push('');

    const functionNames = {
        presenters: {},
        resolvers: {},
        validators: {},
        enumerators: {},
        derivators: {},
        fieldNamePresenters: {},
        global: {}
    };

    // Helper to process a category
    const processCategory = (category) => {
        for (const [name, code] of Object.entries(functions[category] || {})) {
            let exportCode = code.trim();
            if (!exportCode.startsWith('export ')) {
                exportCode = 'export ' + exportCode;
            }
            lines.push(exportCode);
            lines.push('');
            functionNames[category][name] = name;
        }
    };

    processCategory('fieldNamePresenters');
    processCategory('presenters');
    processCategory('resolvers');
    processCategory('validators');
    processCategory('enumerators');
    processCategory('derivators');
    processCategory('global');

    // Now construct the functions object export
    lines.push('export const functions = {');
    for (const category of Object.keys(functionNames)) {
        lines.push(`    ${category}: {`);
        for (const [name, ref] of Object.entries(functionNames[category])) {
            lines.push(`        ${name}: ${ref},`);
        }
        lines.push(`    },`);
    }
    lines.push('};');

    return lines.join('\n');
}