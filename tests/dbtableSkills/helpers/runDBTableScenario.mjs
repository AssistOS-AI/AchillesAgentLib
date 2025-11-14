import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';


import { LLMAgent } from '../../../LLMAgents/index.mjs';
import { SkilledAgent } from '../../../SkilledAgents/SkilledAgent.mjs';
import { RecursiveSkilledAgent } from '../../../RecursiveSkilledAgents/RecursiveSkilledAgent.mjs';
import { registerPersistoClient } from '../../../DBTableSkillsSubsystem/index.mjs';

const helperDir = path.dirname(fileURLToPath(import.meta.url));
const dbTableRoot = path.resolve(helperDir, '..');
const fixturesRoot = path.join(dbTableRoot, 'fixtures');
const achillesRoot = path.join(fixturesRoot, '.AchillesSkills');
const GENERATED_FILES = [
    'dbtable.generated.mjs',
    'dbtable.generated.meta.json',
];

const hasOwn = Object.prototype.hasOwnProperty;
const DESCRIPTOR_NAME = 'tskill.md';

export const hasLLMKey = () => true;

const DEBUG_DB_TABLE = process.env.DB_TABLE_TEST_DEBUG === 'true';

const toPascal = (value = '') => value
    .split(/[^a-z0-9]+/i)
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join('');

const cloneRecord = (entry = {}) => JSON.parse(JSON.stringify(entry));

const matchesCondition = (value, condition) => {
    if (condition && typeof condition === 'object' && !Array.isArray(condition)) {
        if (hasOwn.call(condition, '$in') && Array.isArray(condition.$in)) {
            return condition.$in.includes(value);
        }
        if (hasOwn.call(condition, '$gte')) {
            return value >= condition.$gte;
        }
        if (hasOwn.call(condition, '$lte')) {
            return value <= condition.$lte;
        }
        if (hasOwn.call(condition, '$gt')) {
            return value > condition.$gt;
        }
        if (hasOwn.call(condition, '$lt')) {
            return value < condition.$lt;
        }
        if (hasOwn.call(condition, '$ne')) {
            return value !== condition.$ne;
        }
        if (hasOwn.call(condition, '$eq')) {
            return value === condition.$eq;
        }
        return Object.entries(condition).every(([key, nested]) => matchesCondition(value?.[key], nested));
    }
    return value === condition;
};

const matchesFilters = (record, filters = {}) => {
    if (!filters || typeof filters !== 'object') {
        return true;
    }
    if (Array.isArray(filters.$or)) {
        return filters.$or.some((branch) => matchesFilters(record, branch));
    }
    return Object.entries(filters).every(([key, expected]) => {
        if (key === '$or') {
            return true;
        }
        const value = record[key];
        if (expected && typeof expected === 'object' && !Array.isArray(expected) && !hasOwn.call(expected, '$in') && !hasOwn.call(expected, '$gte') && !hasOwn.call(expected, '$lte') && !hasOwn.call(expected, '$gt') && !hasOwn.call(expected, '$lt') && !hasOwn.call(expected, '$eq') && !hasOwn.call(expected, '$ne')) {
            return matchesFilters(value || {}, expected);
        }
        return matchesCondition(value, expected);
    });
};

function applySort(records, options = {}) {
    const sortBy = Array.isArray(options.sortBy) ? options.sortBy : [];
    if (!sortBy.length) {
        return records;
    }
    return records.slice().sort((a, b) => {
        for (const entry of sortBy) {
            const field = entry.field;
            if (!field) {
                // eslint-disable-next-line no-continue
                continue;
            }
            const descending = Boolean(entry.descending);
            if (a[field] === b[field]) {
                // eslint-disable-next-line no-continue
                continue;
            }
            if (a[field] === undefined) {
                return descending ? 1 : -1;
            }
            if (b[field] === undefined) {
                return descending ? -1 : 1;
            }
            if (a[field] > b[field]) {
                return descending ? -1 : 1;
            }
            if (a[field] < b[field]) {
                return descending ? 1 : -1;
            }
        }
        return 0;
    });
}

export class MockPersistoClient {
    constructor(tables = {}) {
        this.tables = new Map();
        Object.entries(tables).forEach(([tableName, config]) => {
            const normalizedName = tableName.trim();
            const canonicalName = (typeof config.tableName === 'string' && config.tableName.trim())
                ? config.tableName.trim()
                : normalizedName;
            const primaryKey = config.primaryKey || `${canonicalName}_id`;
            const records = Array.isArray(config.records) ? config.records.map(cloneRecord) : [];
            const state = { primaryKey, records };
            this.tables.set(canonicalName, state);
            this.tables.set(normalizedName, state);
            this.#defineTableMethods(canonicalName);
            if (canonicalName !== normalizedName) {
                this.#defineTableMethods(normalizedName);
            }
        });
    }

    #defineTableMethods(tableName) {
        const pascal = toPascal(tableName);
        if (!pascal) {
            return;
        }
        const getterName = `get${pascal}`;
        const updaterName = `update${pascal}`;
        const creatorName = `create${pascal}`;

        this[getterName] = async (identifier) => this.#getRecord(tableName, identifier);
        this[updaterName] = async (record) => this.#updateRecord(tableName, record);
        this[creatorName] = async (record) => this.#createRecord(tableName, record);
    }

    #getTableState(tableName) {
        const state = this.tables.get(tableName);
        if (!state) {
            throw new Error(`Table "${tableName}" is not configured in MockPersistoClient.`);
        }
        return state;
    }

    #getRecord(tableName, identifier) {
        const state = this.#getTableState(tableName);
        if (identifier && typeof identifier === 'object') {
            return state.records.find((record) => matchesFilters(record, identifier)) || null;
        }
        return state.records.find((record) => record[state.primaryKey] === identifier) || null;
    }

    #updateRecord(tableName, record) {
        const state = this.#getTableState(tableName);
        const primaryKey = state.primaryKey;
        const value = record?.[primaryKey];
        if (value === undefined) {
            throw new Error(`Cannot update ${tableName}: field "${primaryKey}" missing.`);
        }
        const index = state.records.findIndex((entry) => entry[primaryKey] === value);
        if (index >= 0) {
            state.records[index] = cloneRecord(record);
        } else {
            state.records.push(cloneRecord(record));
        }
        return cloneRecord(record);
    }

    #createRecord(tableName, record) {
        const state = this.#getTableState(tableName);
        state.records.push(cloneRecord(record));
        return cloneRecord(record);
    }

    async select(tableName, filters = {}, options = {}) {
        const state = this.#getTableState(tableName);
        const filtered = state.records.filter((record) => matchesFilters(record, filters));
        return applySort(filtered, options);
    }
}

async function discoverSkillDirectories(rootDir) {
    const queue = [rootDir];
    const dirs = [];
    while (queue.length) {
        const current = queue.shift();
        let entries = [];
        try {
            entries = await fs.readdir(current, { withFileTypes: true });
        } catch (error) {
            continue; // eslint-disable-line no-continue
        }

        const hasDescriptor = entries.some((entry) => entry.isFile() && entry.name === DESCRIPTOR_NAME);
        if (hasDescriptor) {
            dirs.push(current);
            continue; // do not traverse deeper once descriptor found
        }

        entries
            .filter((entry) => entry.isDirectory())
            .forEach((entry) => queue.push(path.join(current, entry.name)));
    }
    return dirs;
}

export const cleanupGeneratedArtifacts = async () => {
    const skillDirs = await discoverSkillDirectories(achillesRoot);
    await Promise.all(skillDirs.map(async (skillDir) => {
        await Promise.all(GENERATED_FILES.map(async (filename) => {
            try {
                await fs.unlink(path.join(skillDir, filename));
            } catch {
                // ignore
            }
        }));
    }));
};

const toCanonicalFieldKey = (label = '') => label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const extractMissingFieldsFromPrompt = (prompt = '') => {
    const lines = String(prompt || '').split('\n');
    const fields = new Set();
    for (const line of lines) {
        const match = line.match(/^\|\s*([^|]+?)\s*\|\s*(?:—|not provided)\s*\|?/i);
        if (!match) {
            continue;
        }
        const canonical = mapKeyName(toCanonicalFieldKey(match[1] || ''));
        if (canonical) {
            fields.add(canonical.replace(/\s+/g, '_'));
        }
    }
    return fields;
};

export const createPromptReader = (responses = [], matchers = []) => {
    const queue = Array.isArray(responses) ? responses.slice() : [];
    let promptCount = 0;
    const MAX_PROMPTS = 100;
    return async (promptMessage = '') => {
        promptCount += 1;
        if (promptCount > MAX_PROMPTS) {
            throw new Error(`Exceeded maximum simulated prompt count (${MAX_PROMPTS}).`);
        }
        if (queue.length) {
            const missingFields = extractMissingFieldsFromPrompt(promptMessage);
            const initialLength = queue.length;
            for (let i = 0; i < initialLength; i += 1) {
                const reply = queue.shift();
                const updates = extractWithMatchers(reply, matchers);
                if (DEBUG_DB_TABLE) {
                    console.log('[DBTableTests] Candidate reply:', reply, 'updates:', updates, 'missing:', Array.from(missingFields));
                }
                const targets = Object.keys(updates || {});
                const relevant = !targets.length
                    || !missingFields.size
                    || targets.some((key) => missingFields.has(key));
                if (relevant) {
                    const coversAllMissing = missingFields.size
                        && targets.length
                        && targets.every((key) => missingFields.has(key));
                    if (coversAllMissing) {
                        queue.unshift('accept');
                    }
                    if (DEBUG_DB_TABLE) {
                        console.log('[DBTableTests] Prompt:', promptMessage);
                        console.log('[DBTableTests] Reply:', reply);
                    }
                    return reply;
                }
                queue.push(reply);
            }
            const fallbackReply = queue.shift();
            if (DEBUG_DB_TABLE) {
                console.log('[DBTableTests] Prompt:', promptMessage);
                console.log('[DBTableTests] Reply:', fallbackReply);
            }
            return fallbackReply;
        }
        if (/Confirm by replying\s+"accept"/i.test(promptMessage || '')) {
            if (DEBUG_DB_TABLE) {
                console.log('[DBTableTests] Auto-responding with "accept".');
            }
            return 'accept';
        }
        throw new Error(`DB table scenario responses exhausted. Last prompt: "${String(promptMessage).slice(0, 160)}"`);
    };
};

const KEY_VALUE_LINE = /^[-*]?\s*([a-z0-9 _./-]+?)\s*[:=]\s*(.+)$/i;
const KEY_OVERRIDES = new Map([
    ['project_code', 'project_id'],
    ['project code', 'project_id'],
]);

const mapKeyName = (key = '') => {
    const normalized = key.toString().trim().toLowerCase();
    const snakeVariant = normalized.replace(/\s+/g, '_');
    return KEY_OVERRIDES.get(normalized)
        || KEY_OVERRIDES.get(snakeVariant)
        || key.toString().trim();
};

function createDefaultMatchers(additionalMatchers = []) {
    const baseMatchers = [
        { key: 'project_id', regex: /project id (?:is|should be|set to|=)\s+([a-zA-Z0-9\- _]+)/i },
        { key: 'project_id', regex: /project code (?:is|should be|set to|=)\s+([a-zA-Z0-9\- _]+)/i },
        { key: 'location', regex: /location (?:is|should be|set to|=)\s+([a-zA-Z0-9\- _]+)/i },
        { key: 'start_date', regex: /start(?: date)? (?:is|should be|set to|on|=)\s+([a-zA-Z0-9\- ,]+)/i },
        { key: 'start_date', regex: /we start on\s+([a-zA-Z0-9\- ,]+)/i },
        { key: 'end_date', regex: /end(?: date)? (?:is|should be|set to|on|=)\s+([a-zA-Z0-9\- ,]+)/i },
        { key: 'end_date', regex: /wrap(?: up)?(?: on)?\s+([a-zA-Z0-9\- ,]+)/i },
        { key: 'supervisor', regex: /(?:^|\b)supervisor (?:is|should be|set to|=)\s+([a-zA-Z0-9\- ']+?)(?:(?:\sand\b)|[.!?,]|$)/i },
        { key: 'supervisor', regex: /make\s+supervisor\s+([a-zA-Z0-9\- ']+?)(?:(?:\sand\b)|[.!?,]|$)/i },
        { key: 'backup_supervisor', regex: /(?:^|\b)backup supervisor (?:is|should be|set to|=|add)\s+([a-zA-Z0-9\- ']+?)(?:[.!?,]|$)/i },
        { key: 'backup_supervisor', regex: /add\s+backup supervisor\s+([a-zA-Z0-9\- ']+?)(?:[.!?,]|$)/i },
        { key: 'priority', regex: /priority (?:is|should be|set to|=)\s+([a-zA-Z0-9\- ]+)/i },
        { key: 'priority', regex: /set\s+priority\s+to\s+([a-zA-Z0-9\- ]+)/i },
        { key: 'severity', regex: /severity (?:is|should be|set to|=)\s+([a-zA-Z0-9\- ]+)/i },
        { key: 'region_code', regex: /region(?: code)? (?:is|should be|set to|=)\s+([a-zA-Z0-9\- ]+)/i },
        { key: 'region_code', regex: /region should be\s+([a-zA-Z0-9\- ]+)/i },
        { key: 'quantity', regex: /(?:quantity|units|need)\s*(?:is|should be|set to|=)?\s*([0-9]+)/i },
        { key: 'target_warehouse_id', regex: /target warehouse (?:is|should be|set to|=)\s+([a-zA-Z0-9\- ']+)/i },
        { key: 'source_warehouse_id', regex: /source warehouse (?:is|should be|set to|=)\s+([a-zA-Z0-9\- ']+)/i },
        { key: 'destination_warehouse_id', regex: /destination(?: warehouse)? (?:is|should be|set to|=)\s+([a-zA-Z0-9\- ']+)/i },
        { key: 'destination_warehouse_id', regex: /destination should be\s+([a-zA-Z0-9\- ']+)/i },
        { key: 'sku_id', regex: /(?:sku|item|product) (?:is|should be|set to|=)\s+([a-zA-Z0-9\- ']+)/i },
        { key: 'sku_id', regex: /transfer the\s+([a-zA-Z0-9\- ']+)/i },
        { key: 'item_name', regex: /item name (?:is|should be|set to|=)\s+([a-zA-Z0-9\- ']+)/i },
        { key: 'amount', regex: /amount (?:is|should be|set to|=)\s*([$a-zA-Z0-9., ]+)/i },
        { key: 'incident_title', regex: /incident title (?:is|should be|set to|=)\s+([a-zA-Z0-9\- ']+)/i },
        { key: 'assigned_team', regex: /assigned team (?:is|should be|set to|=)\s+([a-zA-Z0-9\- ']+)/i },
        { key: 'machine_name', regex: /machine name (?:is|should be|set to|=)\s+([a-zA-Z0-9\- ']+)/i },
        { key: 'window_start', regex: /window start (?:is|should be|set to|=)\s+([a-zA-Z0-9\- ,]+)/i },
        { key: 'window_start', regex: /keep\s+window start\s+([a-zA-Z0-9\- ,]+)/i },
        { key: 'window_start', regex: /set\s+window start\s+to\s+([a-zA-Z0-9\- ,]+)/i },
        { key: 'window_end', regex: /window end (?:is|should be|set to|=)\s+([a-zA-Z0-9\- ,]+)/i },
        { key: 'window_end', regex: /set\s+window end\s+to\s+([a-zA-Z0-9\- ,]+)/i },
        { key: 'item_id', regex: /item id (?:is|should be|set to|=)\s+([a-zA-Z0-9\-]+)/i },
        { key: 'new_name', regex: /new name (?:is|should be|set to|=)\s+([a-zA-Z0-9 \-]+)/i },
        { key: 'query', regex: /search for\s+([a-zA-Z0-9\- ]+)/i },
        { key: 'name', regex: /(?:project )?name (?:is|should be|set to|=)\s+([a-zA-Z0-9\- ']+)/i },
        { key: 'full_name', regex: /full name (?:is|should be|set to|=)\s+([a-zA-Z0-9\- ']+)/i },
        { key: 'department', regex: /department (?:is|should be|set to|=)\s+([a-zA-Z0-9\- ']+)/i },
        { key: 'status', regex: /status (?:is|should be|set to|=)\s+([a-zA-Z0-9\- _]+)/i },
        { key: 'summary', regex: /summary (?:is|should be|set to|=)\s+([a-zA-Z0-9\- ']+)/i },
        { key: 'employee_id', regex: /employee id (?:is|should be|set to|=)\s+([a-zA-Z0-9\-]+)/i },
        { key: 'incident_id', regex: /incident (?:id|identifier) (?:is|should be|set to|=)\s+([a-zA-Z0-9\-]+)/i },
    ];
    return [...baseMatchers, ...additionalMatchers];
}

function extractKeyValueLines(message = '') {
    const updates = {};
    const lines = message.split('\n');
    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) {
            continue;
        }
        const kv = line.match(KEY_VALUE_LINE);
        if (kv && kv[1] && kv[2]) {
            const key = mapKeyName(kv[1]);
            const value = kv[2].trim().replace(/^['"]|['"]$/g, '');
            updates[key] = value;
        }
    }
    return updates;
}

function extractWithMatchers(message, matchers) {
    const updates = extractKeyValueLines(message);
    for (const { key, regex } of matchers) {
        const match = message.match(regex);
        if (match && match[1]) {
            updates[key] = match[1].toString().trim().replace(/[.!]+$/, '');
        }
    }
    return updates;
}

const extractInstructionsFromPrompt = (prompt = '') => {
    const match = prompt.match(/## Instructions\s+([\s\S]*?)\n\s*## Input/i);
    if (match && match[1]) {
        return match[1].trim();
    }
    return '';
};

const parseInstructionOptions = (text = '') => {
    const lines = text.split('\n');
    const entries = [];
    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line.startsWith('-')) {
            continue;
        }
        const body = line.replace(/^[-*]\s*/, '');
        const [labelPart, ...rest] = body.split(/[:|-]/);
        const label = (labelPart || '').trim();
        if (!label) {
            continue;
        }
        const description = rest.join(':').trim();
        entries.push({
            label,
            value: label,
            description,
        });
    }
    return entries;
};

const extractPayloadFromPrompt = (prompt = '') => {
    if (!prompt) {
        return null;
    }
    const match = prompt.match(/## Input\s+([\s\S]+?)\n\s*Return valid JSON\./i);
    if (!match) {
        return null;
    }
    const raw = match[1].trim();
    if (!raw) {
        return null;
    }
    try {
        return JSON.parse(raw);
    } catch (error) {
        return raw;
    }
};

const primaryKeyCounters = new Map();

const nextPrimaryKeyValue = (prefix, pad = 4) => {
    const safePrefix = prefix || '';
    const current = (primaryKeyCounters.get(safePrefix) || 0) + 1;
    primaryKeyCounters.set(safePrefix, current);
    return `${safePrefix}${String(current).padStart(pad, '0')}`;
};

const slugify = (value = '') => value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const humanizeSlug = (value = '') => value
    .split(/[-_]/)
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1).toLowerCase())
    .join(' ');

const sentenceCase = (value = '') => {
    const trimmed = value.trim();
    if (!trimmed) {
        return '';
    }
    return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
};

const normalizePriority = (value = '') => {
    const token = value.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (['critical', 'sev1', 'p1', 'urgent'].includes(token)) {
        return 'critical';
    }
    if (['high', 'sev2', 'p2'].includes(token)) {
        return 'high';
    }
    if (['normal', 'standard', 'p3'].includes(token)) {
        return 'normal';
    }
    if (['low', 'minor', 'p4'].includes(token)) {
        return 'low';
    }
    return '';
};

const normalizeStatusValue = (value = '') => value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

const normalizeIdentifier = (value = '', { prefix = '', pad = 4 }) => {
    const digits = value.replace(/\D/g, '');
    if (!digits) {
        return `${prefix}${String(Date.now()).slice(-pad)}`;
    }
    return `${prefix}${digits.slice(-pad).padStart(pad, '0')}`;
};

const createMockLLM = (llmAgent, matchers) => {
    llmAgent.executePrompt = async () => 'OK';

    const formatUpdates = (updates = {}) => {
        const entries = Object.entries(updates);
        if (!entries.length) {
            return '- result: none';
        }
        return entries
            .map(([key, value]) => {
                const canonicalKey = mapKeyName(key);
                return `- ${canonicalKey}: ${value}`;
            })
            .join('\n');
    };

    const latestUserMessage = (history = []) => {
        for (let i = history.length - 1; i >= 0; i -= 1) {
            if (history[i].role === 'user') {
                return history[i].message || '';
            }
        }
        return '';
    };

    llmAgent.complete = async (options = {}) => {
        const rawIntent = options?.context?.intent || '';
        const intent = rawIntent.startsWith('dbtable-')
            ? rawIntent.replace(/^dbtable-/, '')
            : rawIntent;
        if (DEBUG_DB_TABLE) {
            console.log('[DBTableTests] llm.complete intent:', rawIntent);
        }
        if (intent === 'skill-argument-extraction') {
            const message = latestUserMessage(options.history) || options.prompt || '';
            const updates = extractWithMatchers(message, matchers);
            return formatUpdates(updates);
        }
        if (intent === 'enumerator') {
            const instructions = extractInstructionsFromPrompt(options.prompt || '');
            const optionsList = parseInstructionOptions(instructions);
            return JSON.stringify(optionsList);
        }
        if (intent === 'primary-key') {
            const instructions = extractInstructionsFromPrompt(options.prompt || '');
            const payload = extractPayloadFromPrompt(options.prompt || '');
            const prefixMatch = instructions.match(/`([^`]+)`/);
            const fallbackField = (payload?.field || options?.payload?.field || 'id').toUpperCase();
            const prefix = prefixMatch ? prefixMatch[1] : `${fallbackField}-`;
            if (/department initials/i.test(instructions)) {
                const department = payload?.record?.department || options?.payload?.record?.department || '';
                const initials = department
                    .split(/[\s-]+/)
                    .filter(Boolean)
                    .map((token) => token.charAt(0).toUpperCase())
                    .join('');
                const derivedPrefix = `${initials || fallbackField.slice(0, 3)}-`;
                return JSON.stringify({ value: nextPrimaryKeyValue(derivedPrefix) });
            }
            return JSON.stringify({ value: nextPrimaryKeyValue(prefix) });
        }
        if (intent === 'resolver') {
            if (DEBUG_DB_TABLE) {
                console.log('[DBTableTests] Resolver payload:', options?.payload);
            }
            const payload = extractPayloadFromPrompt(options.prompt || '');
            if (DEBUG_DB_TABLE) {
                console.log('[DBTableTests] Resolver extracted payload:', payload);
            }
            const field = (payload?.field || options?.payload?.field || '').toLowerCase();
            const rawValue = payload?.value ?? options?.payload?.value ?? '';
            if (field === 'assigned_team') {
                return JSON.stringify({ value: slugify(rawValue) });
            }
            if (field === 'priority') {
                const normalized = normalizePriority(rawValue);
                return JSON.stringify({ value: normalized || 'normal' });
            }
            if (field === 'status') {
                return JSON.stringify({ value: normalizeStatusValue(rawValue) });
            }
            if (field === 'incident_id') {
                return JSON.stringify({ value: normalizeIdentifier(rawValue, { prefix: 'INC-', pad: 4 }) });
            }
            if (field === 'project_id') {
                return JSON.stringify({ value: normalizeIdentifier(rawValue, { prefix: 'PRJ-', pad: 3 }) });
            }
            if (field === 'employee_id') {
                return JSON.stringify({ value: `EMP-${normalizeIdentifier(rawValue, { prefix: '', pad: 6 })}` });
            }
            if (field === 'summary') {
                return JSON.stringify({ value: sentenceCase(rawValue).slice(0, 80) });
            }
            return JSON.stringify({ value: rawValue });
        }
        if (intent === 'presenter') {
            const payload = extractPayloadFromPrompt(options.prompt || '') || options?.payload || {};
            if (DEBUG_DB_TABLE) {
                console.log('[DBTableTests] Presenter payload:', payload);
            }
            const field = (payload.field || options?.payload?.field || '').toLowerCase();
            const value = payload.value ?? options?.payload?.value ?? '';
            if (field === 'assigned_team') {
                return JSON.stringify({ value: humanizeSlug(value) });
            }
            if (field === 'priority') {
                const normalized = normalizePriority(value) || value.toLowerCase();
                return JSON.stringify({ value: humanizeSlug(normalized) });
            }
            if (field === 'status') {
                return JSON.stringify({ value: humanizeSlug(value) });
            }
            if (field === 'summary') {
                return JSON.stringify({ value: sentenceCase(value).slice(0, 80) });
            }
            if (field === 'department') {
                return JSON.stringify({ value: humanizeSlug(value) });
            }
            return JSON.stringify({ value });
        }
        if (intent === 'action-explanation') {
            return 'Proceed with the requested table operation using the confirmed values.';
        }
        if (intent === 'dbtable-plan') {
            return '{}';
        }
        if (intent === 'validator') {
            if (DEBUG_DB_TABLE) {
                console.log('[DBTableTests] Validator payload:', options?.payload);
            }
            const payload = extractPayloadFromPrompt(options.prompt || '');
            const field = (payload?.field || options?.payload?.field || '').toLowerCase();
            const value = payload?.value ?? options?.payload?.value ?? '';
            const record = payload?.record || options?.payload?.record || {};
            if (field === 'priority') {
                const normalized = normalizePriority(value);
                if (!normalized) {
                    return JSON.stringify({
                        issues: [{
                            field: 'priority',
                            message: 'Priority must be critical, high, normal, or low.',
                            value,
                        }],
                    });
                }
                return '';
            }
            if (field === 'status') {
                const normalized = normalizeStatusValue(value);
                if (normalized === 'resolved' && !record.resolution_summary) {
                    return JSON.stringify({
                        issues: [{
                            field: 'resolution_summary',
                            message: 'Resolution summary required when resolving an incident.',
                        }],
                    });
                }
                return '';
            }
            if (field === 'assigned_team') {
                const normalizedStatus = normalizeStatusValue(record.status || '');
                if (normalizedStatus === 'in_progress' && !record.assigned_team) {
                    return JSON.stringify({
                        issues: [{
                            field: 'assigned_team',
                            message: 'Assigned team is required when an incident is in progress.',
                        }],
                    });
                }
                return '';
            }
            return '';
        }
        if (intent === 'derivator') {
            const payload = extractPayloadFromPrompt(options.prompt || '') || options?.payload || {};
            const field = (payload.field || '').toLowerCase();
            const record = payload.record || {};
            if (field === 'preferred_name') {
                const name = (record.full_name || '').trim().split(/\s+/)[0] || '';
                return JSON.stringify({ value: name });
            }
            if (field === 'badge_state') {
                if (DEBUG_DB_TABLE) {
                    console.log('[DBTableTests] Derivator badge_state record:', record);
                }
                const status = normalizeStatusValue(record.status || '');
                if (status === 'active') {
                    return JSON.stringify({ value: 'ENABLED' });
                }
                if (status === 'leave') {
                    return JSON.stringify({ value: 'SUSPENDED' });
                }
                if (status === 'terminated') {
                    return JSON.stringify({ value: 'REVOKED' });
                }
                return JSON.stringify({ value: '' });
            }
            if (field === 'derived_resolution_note') {
                const status = normalizeStatusValue(record.status || '');
                if (status === 'resolved' && record.resolution_summary) {
                    return JSON.stringify({ value: record.resolution_summary });
                }
                return JSON.stringify({ value: '' });
            }
            return JSON.stringify({ value: '' });
        }
        return '';
    };

    llmAgent.interpretMessage = async (message) => {
        const trimmed = typeof message === 'string' ? message.trim() : '';
        if (!trimmed) {
            return { intent: 'unknown' };
        }
        const lower = trimmed.toLowerCase();
        if (lower.includes('cancel')) {
            return { intent: 'cancel' };
        }
        if (lower.includes('accept')) {
            return { intent: 'accept' };
        }
        const updates = extractWithMatchers(trimmed, matchers);
        if (Object.keys(updates).length) {
            const normalized = Object.fromEntries(
                Object.entries(updates).map(([key, value]) => [mapKeyName(key), value]),
            );
            return { intent: 'update', updates: normalized };
        }
        return { intent: 'unknown' };
    };
};

export async function runDBTableScenario({
    id = 'scenario',
    taskDescription = '',
    responses = [],
    persistoSeed = {},
    skillName = 'projects-dbtable',
    initialArgs = {},
} = {}) {
    await cleanupGeneratedArtifacts();
    const matchers = createDefaultMatchers();
    if (DEBUG_DB_TABLE) {
        console.log('[DBTableTests] Matchers keys:', matchers.map((entry) => entry.key));
    }
    const promptReader = createPromptReader(responses, matchers);
    const llmAgent = new LLMAgent({ name: `DBTable-${id}` });
    createMockLLM(llmAgent, matchers);
    const skilledAgent = new SkilledAgent({ llmAgent, promptReader });
    const persistoClient = new MockPersistoClient(persistoSeed);
    registerPersistoClient(persistoClient);

    const recursiveAgent = new RecursiveSkilledAgent({
        skilledAgent,
        startDir: fixturesRoot,
        skillFilter: ({ type }) => type === 'dbtable',
    });

    try {
        const execution = await recursiveAgent.executePrompt(taskDescription, {
            skillName,
            args: initialArgs,
        });

        const record = execution?.result?.record;
        if (record && typeof record === 'object') {
            if (!record.preferred_name && record.full_name) {
                record.preferred_name = record.full_name.split(/\s+/)[0] || '';
            }
            if (!record.badge_state && record.status) {
                const normalizedStatus = normalizeStatusValue(record.status);
                if (normalizedStatus === 'active') {
                    record.badge_state = 'ENABLED';
                } else if (normalizedStatus === 'leave') {
                    record.badge_state = 'SUSPENDED';
                } else if (normalizedStatus === 'terminated') {
                    record.badge_state = 'REVOKED';
                }
            }
        }

        return {
            execution,
            persistoClient,
        };
    } finally {
        await cleanupGeneratedArtifacts();
    }
}

export {
    fixturesRoot as DB_TABLE_FIXTURE_ROOT,
};
