import { runInteractiveSkill } from '../../InteractiveSkillsSubsystem/executor/runInteractiveSkill.mjs';
import { buildTableClient } from '../persisto/registry.mjs';

const OPERATION_ALIASES = new Map([
    ['display', 'display-table'],
    ['display-table', 'display-table'],
    ['list', 'display-table'],
    ['list-table', 'display-table'],
    ['show-table', 'display-table'],
    ['display-record', 'display-record'],
    ['show-record', 'display-record'],
    ['view-record', 'display-record'],
    ['record', 'display-record'],
    ['create', 'create-record'],
    ['create-record', 'create-record'],
    ['add', 'create-record'],
    ['insert', 'create-record'],
    ['update', 'update-record'],
    ['modify', 'update-record'],
    ['change', 'update-record'],
    ['update-record', 'update-record'],
]);

const toDisplayString = (value) => {
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
};

const safeJsonParse = (value, fallback = null) => {
    if (typeof value !== 'string') {
        return value ?? fallback;
    }
    const trimmed = value.trim();
    if (!trimmed) {
        return fallback;
    }
    try {
        return JSON.parse(trimmed);
    } catch (error) {
        return fallback;
    }
};

const normalizeOperation = (operation) => {
    if (!operation || typeof operation !== 'string') {
        return null;
    }
    const key = operation.trim().toLowerCase().replace(/\s+/g, '-');
    return OPERATION_ALIASES.get(key) || null;
};

function heuristicOperation(promptText = '') {
    const text = (promptText || '').toLowerCase();
    if (!text) {
        return 'display-table';
    }
    if (/(create|add|new)\b/.test(text)) {
        return 'create-record';
    }
    if (/(update|change|modify)\b/.test(text)) {
        return 'update-record';
    }
    if ((/details?\b/.test(text) || /record\b/.test(text)) && /(show|display|view|open)\b/.test(text)) {
        return 'display-record';
    }
    if (/project\s+(id|code)\b/.test(text) || /prj-\d+/i.test(text)) {
        return 'display-record';
    }
    if (/(list|show|display)\b/.test(text)) {
        return 'display-table';
    }
    return 'display-table';
}

async function buildOperationPlan({
    blueprint,
    promptText,
    args = {},
    llmAgent,
}) {
    const basePlan = {
        operation: heuristicOperation(promptText),
        filters: {},
        values: {},
        recordIdentifier: {},
    };

    if (args.operation) {
        const normalized = normalizeOperation(args.operation);
        if (normalized) {
            basePlan.operation = normalized;
        }
    }

    if (args.filters && typeof args.filters === 'object') {
        basePlan.filters = { ...args.filters };
    }
    if (args.values && typeof args.values === 'object') {
        basePlan.values = { ...args.values };
    }
    if (args.recordIdentifier && typeof args.recordIdentifier === 'object') {
        basePlan.recordIdentifier = { ...args.recordIdentifier };
    }

    if (!llmAgent || typeof llmAgent.complete !== 'function') {
        return basePlan;
    }

    const fieldSummaries = blueprint.fields
        .map((field) => `- ${field.name}${field.required ? ' (required)' : ''}: ${field.description || 'No description'}`)
        .join('\n');

    const promptLines = [
        '# DB Table Skill Planner',
        `Table name: ${blueprint.tableName}`,
        `Summary: ${blueprint.summary || 'No summary provided.'}`,
        '',
        '## Supported operations',
        '- display_table: show a table view of matching records',
        '- display_record: show a single record, identified via primary key or filters',
        '- create_record: create a new record using provided values',
        '- update_record: update an existing record identified by its primary key',
        '',
        '## Fields',
        fieldSummaries,
        '',
        '## User request',
        promptText || '<no prompt>',
        '',
        'Respond with JSON using the shape:',
        '{ "operation": "<operation>", "filters": {...}, "recordIdentifier": {...}, "values": {...} }',
        'Only include keys when relevant. Prefer concise filters based on the request.',
    ];

    try {
        const response = await llmAgent.complete({
            prompt: promptLines.join('\n'),
            mode: 'fast',
            context: { intent: 'dbtable-plan' },
        });
        const parsed = safeJsonParse(typeof response === 'string' ? response : JSON.stringify(response), null);
        if (parsed && typeof parsed === 'object') {
            if (parsed.operation) {
                const normalized = normalizeOperation(parsed.operation);
                if (normalized) {
                    basePlan.operation = normalized;
                }
            }
            if (parsed.filters && typeof parsed.filters === 'object') {
                basePlan.filters = { ...basePlan.filters, ...parsed.filters };
            }
            if (parsed.values && typeof parsed.values === 'object') {
                basePlan.values = { ...basePlan.values, ...parsed.values };
            }
            if (parsed.recordIdentifier && typeof parsed.recordIdentifier === 'object') {
                basePlan.recordIdentifier = { ...basePlan.recordIdentifier, ...parsed.recordIdentifier };
            }
        }
    } catch (error) {
        // Fallback to heuristic plan
    }

    return basePlan;
}

function buildMarkdownTable(headers = [], rows = []) {
    if (!rows.length) {
        return 'No records found.';
    }
    const headerLine = `| ${headers.join(' | ')} |`;
    const separator = `| ${headers.map(() => '---').join(' | ')} |`;
    const body = rows.map((row) => `| ${row.join(' | ')} |`).join('\n');
    return [headerLine, separator, body].join('\n');
}

async function presentRecords(records, { blueprint, generated, llmAgent }) {
    const presented = [];
    for (const record of records) {
        // eslint-disable-next-line no-await-in-loop
        const result = await generated.presentRecord(record, { llmAgent });
        presented.push(result);
    }
    return presented;
}

async function renderTable(records, { blueprint, generated, llmAgent }) {
    if (!records.length) {
        return {
            markdown: 'No records matched the provided filters.',
            rows: [],
        };
    }
    const presented = await presentRecords(records, { blueprint, generated, llmAgent });
    const columns = blueprint.fieldOrder || blueprint.fields.map((field) => field.name);
    const headers = columns.map((fieldName) => generated.fieldNamePresenterFunction(fieldName));
    const rows = presented.map((row) => columns.map((fieldName) => toDisplayString(row[fieldName])));
    return {
        markdown: buildMarkdownTable(headers, rows),
        rows: presented,
    };
}

const buildRecordTable = (record, generated) => {
    if (!record) {
        return 'No data available.';
    }
    const rows = Object.entries(record).map(([fieldName, value]) => [
        generated.fieldNamePresenterFunction(fieldName),
        toDisplayString(value),
    ]);
    return buildMarkdownTable(['Field', 'Value'], rows);
};

const buildOptionalFieldsTable = (optionalEntries = [], generated) => {
    if (!optionalEntries.length) {
        return '';
    }
    const rows = optionalEntries.map((entry) => [
        generated.fieldNamePresenterFunction(entry.name),
        entry.description || '',
    ]);
    return buildMarkdownTable(['Optional Field', 'Description'], rows);
};

const buildIssuesTable = (issues = []) => {
    if (!issues.length) {
        return '';
    }
    const rows = issues.map((issue) => [
        issue.friendlyName || issue.field,
        toDisplayString(issue.value),
        issue.message || '',
        (Array.isArray(issue.suggestions) && issue.suggestions.length)
            ? issue.suggestions.join(', ')
            : '—',
    ]);
    return buildMarkdownTable(['Field', 'Value', 'Problem', 'Suggestions'], rows);
};

const parseValidationIssues = (payload) => {
    if (!payload) {
        return [];
    }
    const parsed = safeJsonParse(payload, null);
    if (parsed && Array.isArray(parsed.issues)) {
        return parsed.issues;
    }
    return [];
};

function deriveIdentifierFromPlan(plan, blueprint) {
    const primaryKeys = blueprint.primaryKeys || [];
    if (!primaryKeys.length) {
        return null;
    }
    const identifier = {};
    let populated = false;
    for (const key of primaryKeys) {
        if (Object.prototype.hasOwnProperty.call(plan.recordIdentifier, key)) {
            identifier[key] = plan.recordIdentifier[key];
            populated = true;
        } else if (Object.prototype.hasOwnProperty.call(plan.filters, key)) {
            identifier[key] = plan.filters[key];
            populated = true;
        }
    }

    if (!populated) {
        return null;
    }

    if (primaryKeys.length === 1) {
        return identifier[primaryKeys[0]];
    }
    return identifier;
}

function buildArgumentDefinition(field, session) {
    const enumerator = () => session.generated.enumeratorFunction(field.name, {
        llmAgent: session.llmAgent,
        record: session.currentRecord,
    });
    const presenter = async (value) => {
        const presented = await session.generated.presentRecord({ [field.name]: value }, {
            llmAgent: session.llmAgent,
        });
        return presented[field.name];
    };
    const resolver = async (value) => {
        const prepared = await session.generated.prepareRecord({ [field.name]: value }, {
            llmAgent: session.llmAgent,
        });
        if (Object.prototype.hasOwnProperty.call(prepared, field.name)) {
            return prepared[field.name];
        }
        return value;
    };
    const validator = async (value) => {
        if (!field.required && !field.validator) {
            return true;
        }
        const record = {
            ...session.currentRecord,
            [field.name]: value,
        };
        const result = await session.generated.validatorFunction(record, { llmAgent: session.llmAgent });
        if (!result) {
            return true;
        }
        try {
            const parsed = JSON.parse(result);
            if (Array.isArray(parsed.issues)) {
                const issue = parsed.issues.find((entry) => entry.field === field.name);
                if (issue) {
                    if (process.env.DB_TABLE_TEST_DEBUG === 'true') {
                        console.log('[DBTableTests] Validator issue for', field.name, ':', issue);
                    }
                    return {
                        valid: false,
                        value,
                        message: issue.message || 'Invalid value',
                    };
                }
            }
        } catch (error) {
            return true;
        }
        return true;
    };

    return {
        type: 'string',
        description: field.description || '',
        enumerator,
        presenter,
        resolver,
        validator,
    };
}

async function collectFieldValues({
    blueprint,
    generated,
    llmAgent,
    readUserPrompt,
    taskDescription,
    includeFields = null,
    providedArgs = {},
    mode = 'create',
}) {
    if (typeof readUserPrompt !== 'function') {
        throw new Error('DB table skills require a prompt reader for interactive operations.');
    }

    const allowedFields = includeFields
        ? blueprint.fields.filter((field) => includeFields.has(field.name))
        : blueprint.fields.filter((field) => !(blueprint.derivedFields || []).includes(field.name));

    const requiredArguments = allowedFields
        .filter((field) => (mode === 'create' && field.required && field.required.trim()))
        .map((field) => field.name);

    const session = {
        llmAgent,
        generated,
        currentRecord: { ...providedArgs },
    };

    const argumentAliases = {};
    const args = {};
    const argumentMetadata = {};
    const argumentOrder = [];
    allowedFields.forEach((field) => {
        args[field.name] = buildArgumentDefinition(field, session);
        if (field.aliases?.length) {
            argumentAliases[field.name] = field.aliases;
        }
        argumentOrder.push(field.name);
        argumentMetadata[field.name] = {
            name: field.name,
            type: 'string',
            description: field.description || '',
            enumerator: args[field.name].enumerator,
            resolver: args[field.name].resolver,
            validator: args[field.name].validator,
            presenter: args[field.name].presenter,
        };
    });

    const skill = {
        name: `${blueprint.tableName}-${mode}-collector`,
        description: blueprint.summary || `Collect values for ${blueprint.tableName}`,
        arguments: args,
        requiredArguments,
        argumentAliases,
        needConfirmation: true,
        argumentMetadata,
        argumentOrder,
    };

    const action = async (finalArgs) => finalArgs;

    const result = await runInteractiveSkill({
        skill,
        action,
        providedArgs,
        llmAgent,
        readUserPrompt,
        taskDescription,
    });

    session.currentRecord = { ...session.currentRecord, ...result };
    return result;
}

function listOptionalFields(blueprint, record) {
    const optional = [];
    blueprint.fields.forEach((field) => {
        const isRequired = Boolean(field.required && field.required.trim());
        if (isRequired) {
            return;
        }
        const value = record[field.name];
        const hasValue = value !== undefined && value !== null && value !== '';
        if (!hasValue) {
            optional.push({
                name: field.name,
                description: field.description || '',
            });
        }
    });
    return optional;
}

async function handleCreate({
    blueprint,
    generated,
    llmAgent,
    readUserPrompt,
    taskDescription,
    tableClient,
    plan,
}) {
    const collected = await collectFieldValues({
        blueprint,
        generated,
        llmAgent,
        readUserPrompt,
        taskDescription,
        providedArgs: plan.values,
        mode: 'create',
    });

    const prepared = await generated.prepareRecord(collected, { llmAgent });
    if (process.env.DB_TABLE_TEST_DEBUG === 'true') {
        console.log('[DBTableTests] Prepared record:', prepared);
    }
    const validation = await generated.validatorFunction(prepared, { llmAgent });
    if (validation) {
        const issues = parseValidationIssues(validation);
        return {
            operation: 'create-record',
            status: 'invalid',
            issues,
            issuesMarkdown: buildIssuesTable(issues),
        };
    }
    const withPK = await generated.generatePKValues(prepared, { llmAgent });
    if (process.env.DB_TABLE_TEST_DEBUG === 'true') {
        console.log('[DBTableTests] Record with PK:', withPK);
    }
    const created = await tableClient.create(withPK);
    const presented = await generated.presentRecord(created, { llmAgent });
    const optionalEntries = listOptionalFields(blueprint, withPK);
    return {
        operation: 'create-record',
        status: 'ok',
        record: presented,
        recordTable: buildRecordTable(presented, generated),
        optionalMissing: optionalEntries.map((entry) => entry.name),
        optionalMissingDetails: optionalEntries,
        optionalMissingMarkdown: buildOptionalFieldsTable(optionalEntries, generated),
        autoGenerated: Object.keys(withPK).filter((key) => prepared[key] !== withPK[key]),
    };
}

async function ensureRecordIdentifier({
    blueprint,
    generated,
    llmAgent,
    readUserPrompt,
    taskDescription,
    plan,
}) {
    const derivedValue = deriveIdentifierFromPlan(plan, blueprint);
    if (derivedValue !== null && derivedValue !== undefined) {
        return derivedValue;
    }
    if (!readUserPrompt) {
        throw new Error('Unable to determine record identifier and no prompt reader is available.');
    }
    if (!(blueprint.primaryKeys || []).length) {
        throw new Error('Table definition does not declare primary keys.');
    }
    const includeFields = new Set(blueprint.primaryKeys);
    const collected = await collectFieldValues({
        blueprint,
        generated,
        llmAgent,
        readUserPrompt,
        taskDescription,
        includeFields,
        mode: 'identifier',
    });
    if (blueprint.primaryKeys.length === 1) {
        return collected[blueprint.primaryKeys[0]];
    }
    return collected;
}

async function handleUpdate({
    blueprint,
    generated,
    llmAgent,
    readUserPrompt,
    taskDescription,
    tableClient,
    plan,
}) {
    const identifier = await ensureRecordIdentifier({
        blueprint,
        generated,
        llmAgent,
        readUserPrompt,
        taskDescription,
        plan,
    });

    const existing = await tableClient.get(identifier);
    if (!existing) {
        return {
            operation: 'update-record',
            status: 'not-found',
            identifier,
        };
    }

    const providedArgs = { ...existing, ...plan.values };
    const collected = await collectFieldValues({
        blueprint,
        generated,
        llmAgent,
        readUserPrompt,
        taskDescription,
        providedArgs,
        mode: 'update',
    });

    const prepared = await generated.prepareRecord({ ...existing, ...collected }, { llmAgent });
    const validation = await generated.validatorFunction(prepared, { llmAgent });
    if (validation) {
        const issues = parseValidationIssues(validation);
        return {
            operation: 'update-record',
            status: 'invalid',
            issues,
            issuesMarkdown: buildIssuesTable(issues),
        };
    }
    const updated = await tableClient.update(prepared);
    const presented = await generated.presentRecord(updated, { llmAgent });
    return {
        operation: 'update-record',
        status: 'ok',
        record: presented,
        recordTable: buildRecordTable(presented, generated),
    };
}

async function handleDisplayRecord({
    blueprint,
    generated,
    llmAgent,
    readUserPrompt,
    taskDescription,
    tableClient,
    plan,
}) {
    const identifier = await ensureRecordIdentifier({
        blueprint,
        generated,
        llmAgent,
        readUserPrompt,
        taskDescription,
        plan,
    });
    const record = await tableClient.get(identifier);
    if (!record) {
        return {
            operation: 'display-record',
            status: 'not-found',
            identifier,
        };
    }
    const presented = await generated.presentRecord(record, { llmAgent });
    const fields = blueprint.fieldOrder || blueprint.fields.map((field) => field.name);
    const rows = fields.map((fieldName) => [
        generated.fieldNamePresenterFunction(fieldName),
        toDisplayString(presented[fieldName]),
    ]);
    const markdown = buildMarkdownTable(['Field', 'Value'], rows);
    return {
        operation: 'display-record',
        status: 'ok',
        record: presented,
        markdown,
        recordTable: markdown,
    };
}

export async function runDBTableSkill({
    skillRecord,
    blueprint,
    generated,
    llmAgent,
    promptText,
    readUserPrompt,
    args = {},
    taskDescription = '',
}) {
    if (!skillRecord || !blueprint || !generated) {
        throw new Error('runDBTableSkill requires the skill record, blueprint, and generated module.');
    }

    const tableClient = buildTableClient(blueprint.tableName);
    const plan = await buildOperationPlan({
        blueprint,
        promptText,
        args,
        llmAgent,
    });

    if (plan.operation === 'create-record') {
        return handleCreate({
            blueprint,
            generated,
            llmAgent,
            readUserPrompt,
            taskDescription: taskDescription || promptText,
            tableClient,
            plan,
        });
    }

    if (plan.operation === 'update-record') {
        return handleUpdate({
            blueprint,
            generated,
            llmAgent,
            readUserPrompt,
            taskDescription: taskDescription || promptText,
            tableClient,
            plan,
        });
    }

    if (plan.operation === 'display-record') {
        return handleDisplayRecord({
            blueprint,
            generated,
            llmAgent,
            readUserPrompt,
            taskDescription: taskDescription || promptText,
            tableClient,
            plan,
        });
    }

    const selection = await tableClient.select(plan.filters || {}, plan.selectOptions || {});
    const rendered = await renderTable(selection || [], {
        blueprint,
        generated,
        llmAgent,
    });
    return {
        operation: 'display-table',
        status: 'ok',
        rows: rendered.rows,
        markdown: rendered.markdown,
    };
}

export default {
    runDBTableSkill,
};
