function safeJsonParse(input, fallback = null) {
    if (input === null || input === undefined) {
        return fallback;
    }
    if (typeof input !== 'string') {
        return input;
    }
    const trimmed = input.trim();
    if (!trimmed) {
        return fallback;
    }
    try {
        return JSON.parse(trimmed);
    } catch (error) {
        return fallback;
    }
}

function normalizeOptionsList(raw = []) {
    if (Array.isArray(raw) && !raw.length) {
        return [];
    }
    const entries = Array.isArray(raw) ? raw : [];
    return entries
        .map((entry) => {
            if (entry === null || entry === undefined) {
                return null;
            }
            if (typeof entry === 'object') {
                if (Object.prototype.hasOwnProperty.call(entry, 'label') || Object.prototype.hasOwnProperty.call(entry, 'value')) {
                    return {
                        label: entry.label ?? entry.value ?? '',
                        value: entry.value ?? entry.label ?? '',
                        description: entry.description ?? '',
                    };
                }
                const [[firstKey, firstValue]] = Object.entries(entry);
                return {
                    label: firstKey,
                    value: firstValue ?? firstKey,
                    description: '',
                };
            }
            return {
                label: String(entry),
                value: entry,
                description: '',
            };
        })
        .filter(Boolean);
}

function toDisplayString(value) {
    if (value === null) {
        return 'null';
    }
    if (value === undefined) {
        return 'not provided';
    }
    if (typeof value === 'string') {
        return value;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
    }
    try {
        return JSON.stringify(value);
    } catch (error) {
        return String(value);
    }
}

async function callLLM(llmAgent, {
    intent,
    instructions,
    payload = {},
    fallback = null,
}) {
    if (!llmAgent || typeof llmAgent.complete !== 'function') {
        return fallback;
    }

    const promptLines = [
        '# DB Table Skill Function',
        `Intent: ${intent}`,
        '',
        '## Instructions',
        instructions?.trim() || '<none>',
        '',
        '## Input',
        typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2),
        '',
        'Return valid JSON.',
    ];

    try {
        const response = await llmAgent.complete({
            prompt: promptLines.join('\n'),
            mode: 'fast',
            context: { intent: `dbtable-${intent}` },
        });
        return typeof response === 'string' ? response.trim() : response;
    } catch (error) {
        return fallback;
    }
}

function normaliseRecordInput(record = {}) {
    if (!record || typeof record !== 'object') {
        return {};
    }
    return { ...record };
}

function createPrimaryKeyValue(fieldName) {
    const timestamp = Date.now().toString(36).toUpperCase();
    return `${fieldName.toUpperCase()}-${timestamp}`;
}

function buildFieldIndex(fields = []) {
    const map = new Map();
    fields.forEach((field) => {
        map.set(field.name, field);
    });
    return map;
}

const hasProvidedValue = (value) => {
    if (value === undefined || value === null) {
        return false;
    }
    if (typeof value === 'string') {
        return value.trim().length > 0;
    }
    if (Array.isArray(value)) {
        return value.length > 0;
    }
    if (typeof value === 'object') {
        return Object.keys(value).length > 0;
    }
    return true;
};

const friendlyNameForField = (fieldIndex, fieldName) => {
    const field = fieldIndex.get(fieldName);
    if (!field) {
        return fieldName;
    }
    return field.displayName || field.name;
};

const buildResolverInstructions = (field) => {
    if (field?.resolver) {
        return field.resolver;
    }
    if (field?.presenter) {
        return [
            'Reverse the presenter instructions below so the value can be stored in the database:',
            field.presenter,
        ].join('\n');
    }
    return '';
};

const buildPresenterInstructions = (field) => {
    if (field?.presenter) {
        return field.presenter;
    }
    if (field?.resolver) {
        return [
            'Create a human-readable string for the field based on how incoming values are normalised:',
            field.resolver,
        ].join('\n');
    }
    return '';
};

async function enrichIssuesWithSuggestions(issues, {
    fieldIndex,
    enumeratorFunction,
    llmAgent,
    record,
    tableName,
}) {
    if (!issues.length) {
        return [];
    }
    const enriched = [];
    for (const issue of issues) {
        const field = fieldIndex.get(issue.field) || null;
        const friendlyName = friendlyNameForField(fieldIndex, issue.field);
        let suggestionEntries = [];
        if (field && typeof enumeratorFunction === 'function') {
            try {
                // eslint-disable-next-line no-await-in-loop
                suggestionEntries = await enumeratorFunction(field.name, {
                    llmAgent,
                    record,
                    tableName,
                });
            } catch (error) {
                suggestionEntries = [];
            }
        }
        const suggestions = Array.isArray(suggestionEntries)
            ? suggestionEntries.slice(0, 5).map((entry) => {
                if (entry && typeof entry === 'object') {
                    return entry.label ?? entry.value ?? '';
                }
                return String(entry);
            }).filter(Boolean)
            : [];

        enriched.push({
            ...issue,
            friendlyName,
            suggestions,
        });
    }
    return enriched;
}

async function resolveWithLLM(field, value, options) {
    if (!field) {
        return value;
    }
    const instructions = buildResolverInstructions(field);
    if (!instructions.trim()) {
        return value;
    }
    const response = await callLLM(options.llmAgent, {
        intent: 'resolver',
        instructions,
        payload: {
            field: field.name,
            value,
            tableName: options.tableName,
        },
        fallback: value,
    });
    if (!response) {
        return value;
    }
    const parsed = safeJsonParse(response, null);
    if (parsed === null || parsed === undefined) {
        return response;
    }
    if (typeof parsed === 'object' && Object.prototype.hasOwnProperty.call(parsed, 'value')) {
        return parsed.value;
    }
    return parsed;
}

async function presentWithLLM(field, value, options) {
    if (!field) {
        return toDisplayString(value);
    }
    const instructions = buildPresenterInstructions(field);
    if (!instructions.trim()) {
        return toDisplayString(value);
    }
    const response = await callLLM(options.llmAgent, {
        intent: 'presenter',
        instructions,
        payload: {
            field: field.name,
            value,
            tableName: options.tableName,
        },
        fallback: value,
    });
    if (!response) {
        return toDisplayString(value);
    }
    const parsed = safeJsonParse(response, null);
    if (parsed === null || parsed === undefined) {
        return toDisplayString(response);
    }
    if (typeof parsed === 'object' && Object.prototype.hasOwnProperty.call(parsed, 'value')) {
        return toDisplayString(parsed.value);
    }
    return toDisplayString(parsed);
}

async function enumerateWithLLM(field, runtime = {}) {
    const response = await callLLM(runtime.llmAgent, {
        intent: 'enumerator',
        instructions: field.enumerator,
        payload: {
            field: field.name,
            record: runtime.record ?? {},
            tableName: runtime.tableName,
        },
        fallback: [],
    });
    const parsed = safeJsonParse(response, []);
    return normalizeOptionsList(parsed);
}

async function deriveWithLLM(field, runtime = {}) {
    if (!field || !field.derivator) {
        return undefined;
    }
    const response = await callLLM(runtime.llmAgent, {
        intent: 'derivator',
        instructions: field.derivator,
        payload: {
            record: runtime.record ?? {},
            tableName: runtime.tableName,
        },
        fallback: null,
    });
    if (response === null || response === undefined) {
        return undefined;
    }
    const parsed = safeJsonParse(response, response);
    if (parsed && typeof parsed === 'object' && Object.prototype.hasOwnProperty.call(parsed, 'value')) {
        return parsed.value;
    }
    return parsed;
}

function detectMissingRequired(fields, record) {
    const issues = [];
    fields.forEach((field) => {
        const isRequired = Boolean(field.required && field.required.trim());
        if (!isRequired) {
            return;
        }
        const value = record[field.name];
        if (!hasProvidedValue(value)) {
            issues.push({
                field: field.name,
                message: field.required || `${field.displayName || field.name} is required.`,
                value,
            });
        }
    });
    return issues;
}

function formatValidationResult(issues = []) {
    if (!issues.length) {
        return '';
    }
    return JSON.stringify({
        valid: false,
        issues,
    });
}

export function createDBTableSkillFunctions(blueprint = {}) {
    if (!blueprint || !Array.isArray(blueprint.fields)) {
        throw new Error('createDBTableSkillFunctions requires a blueprint with fields.');
    }

    const fieldIndex = buildFieldIndex(blueprint.fields);
    const derivedSet = new Set(blueprint.derivedFields || []);
    const tableName = blueprint.tableName;

    const enumeratorFunction = async (fieldName, runtime = {}) => {
        if (!fieldIndex.has(fieldName)) {
            return [];
        }
        const field = fieldIndex.get(fieldName);
        if (Array.isArray(field.enumeratorSamples) && field.enumeratorSamples.length) {
            return normalizeOptionsList(field.enumeratorSamples);
        }
        if (!field.enumerator) {
            return [];
        }
        return enumerateWithLLM(field, {
            ...runtime,
            tableName,
        });
    };

    const fieldNamePresenterFunction = (fieldName) => {
        const field = fieldIndex.get(fieldName);
        if (!field) {
            return fieldName;
        }
        return field.displayName || field.name;
    };

    const presentRecord = async (record = {}, options = {}) => {
        const normalized = normaliseRecordInput(record);
        const output = {};
        for (const field of blueprint.fields) {
            const value = normalized[field.name];
            output[field.name] = await presentWithLLM(field, value, {
                llmAgent: options.llmAgent,
                tableName,
            });
        }

        for (const fieldName of derivedSet) {
            const field = fieldIndex.get(fieldName);
            if (!field) {
                continue;
            }
            const derivedValue = await deriveWithLLM(field, {
                llmAgent: options.llmAgent,
                record: normalized,
                tableName,
            });
            if (derivedValue !== undefined) {
                output[fieldName] = derivedValue;
            }
        }

        return output;
    };

    const prepareRecord = async (record = {}, options = {}) => {
        const normalized = normaliseRecordInput(record);
        const prepared = {};
        for (const field of blueprint.fields) {
            if (!Object.prototype.hasOwnProperty.call(normalized, field.name)) {
                continue;
            }
            const currentValue = normalized[field.name];
            const resolved = await resolveWithLLM(field, currentValue, {
                llmAgent: options.llmAgent,
                tableName,
            });
            prepared[field.name] = resolved;
        }

        derivedSet.forEach((fieldName) => {
            if (Object.prototype.hasOwnProperty.call(prepared, fieldName)) {
                delete prepared[fieldName];
            }
        });

        return prepared;
    };

    const validatorFunction = async (record = {}, options = {}) => {
        const normalized = normaliseRecordInput(record);
        const missingIssues = detectMissingRequired(blueprint.fields, normalized);
        if (missingIssues.length) {
            const enriched = await enrichIssuesWithSuggestions(missingIssues, {
                fieldIndex,
                enumeratorFunction,
                llmAgent: options.llmAgent,
                record: normalized,
                tableName,
            });
            return formatValidationResult(enriched);
        }

        const llmIssues = [];
        for (const field of blueprint.fields) {
            if (!field.validator) {
                continue;
            }
            const userValue = normalized[field.name];
            const response = await callLLM(options.llmAgent, {
                intent: 'validator',
                instructions: field.validator,
                payload: {
                    field: field.name,
                    value: userValue,
                    tableName,
                    record: normalized,
                },
                fallback: null,
            });
            if (!response) {
                continue;
            }
            const parsed = safeJsonParse(response, null);
            const pushIssue = (issue = {}) => {
                llmIssues.push({
                    field: issue.field || field.name,
                    message: issue.message || 'Invalid value',
                    value: Object.prototype.hasOwnProperty.call(issue, 'value') ? issue.value : userValue,
                });
            };

            if (parsed && typeof parsed === 'object') {
                if (Array.isArray(parsed.issues)) {
                    parsed.issues.forEach((issue) => pushIssue(issue));
                    continue;
                }
                if (parsed.valid === false || parsed.message) {
                    pushIssue(parsed);
                    continue;
                }
            }

            if (typeof response === 'string' && response.trim()) {
                pushIssue({ message: response.trim() });
            }
        }

        if (llmIssues.length) {
            const enriched = await enrichIssuesWithSuggestions(llmIssues, {
                fieldIndex,
                enumeratorFunction,
                llmAgent: options.llmAgent,
                record: normalized,
                tableName,
            });
            return formatValidationResult(enriched);
        }

        return '';
    };

    const generatePKValues = async (record = {}, options = {}) => {
        const normalized = normaliseRecordInput(record);
        const output = { ...normalized };
        for (const fieldName of blueprint.primaryKeys || []) {
            const field = fieldIndex.get(fieldName);
            const hasValue = output[fieldName] !== undefined && output[fieldName] !== null && String(output[fieldName]).trim() !== '';
            if (hasValue) {
                continue;
            }
            if (!field || !field.primaryKey) {
                output[fieldName] = createPrimaryKeyValue(fieldName);
                continue;
            }
            const response = await callLLM(options.llmAgent, {
                intent: 'primary-key',
                instructions: field.primaryKey,
                payload: {
                    record: output,
                    tableName,
                    field: fieldName,
                },
                fallback: createPrimaryKeyValue(fieldName),
            });
            if (!response) {
                output[fieldName] = createPrimaryKeyValue(fieldName);
                continue;
            }
            const parsed = safeJsonParse(response, null);
            if (parsed && typeof parsed === 'object' && Object.prototype.hasOwnProperty.call(parsed, 'value')) {
                output[fieldName] = parsed.value;
            } else if (parsed !== null && parsed !== undefined) {
                output[fieldName] = parsed;
            } else {
                output[fieldName] = response;
            }
        }
        return output;
    };

    return {
        blueprint,
        prepareRecord,
        validatorFunction,
        presentRecord,
        generatePKValues,
        enumeratorFunction,
        fieldNamePresenterFunction,
    };
}

export default {
    createDBTableSkillFunctions,
};
