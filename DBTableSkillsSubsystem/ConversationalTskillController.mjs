/**
 * ConversationalTskillController - Multi-turn conversation controller for tskills.
 *
 * Handles the conversational aspects of tskill CRUD operations:
 * - Pending-state confirmation (CREATE, UPDATE, DELETE)
 * - Validation loop with corrections
 * - Slot-filling for missing IDs (UPDATE, DELETE)
 * - Smart filter extraction (SELECT)
 *
 * This is the SINGLE PLACE for all tskill conversation flow logic.
 * Each tskill gets these flows automatically via DBTableSkillsSubsystem.
 */

import {
    resolveConfirmation,
    isYesResponse,
    isNoResponse,
} from '../utils/ConfirmationUtils.mjs';
import { IOServices } from '../services/IOServices.mjs';
import {
    CRUD_OPERATIONS,
    PENDING_STATE_SUFFIXES,
    pendingKey,
    HIDDEN_AUDIT_FIELDS,
    NULL_DISPLAY_VALUE,
    DEFAULT_SELECTION_PAGE_SIZE,
} from './constants.mjs';
import {
    buildParseOperationPrompt,
    buildExtractCreateDataPrompt,
    buildExtractFieldChangesPrompt,
    buildValidationCorrectionPrompt,
    formatFieldInfo,
    formatFieldInfoSimple,
} from './templates/prompts.mjs';

/**
 * Format a record as a markdown table for display.
 * @param {Object} record - Record to format
 * @param {Object} fields - Field definitions from parsedSkill
 * @param {string[]} [excludeFields] - Fields to exclude from display
 * @returns {string} Markdown table
 */
function formatRecordTable(record, fields, excludeFields = [], options = {}) {
    const hiddenFields = new Set([
        ...HIDDEN_AUDIT_FIELDS,
        ...excludeFields,
    ]);
    const resolveLabel = typeof options.resolveLabel === 'function'
        ? options.resolveLabel
        : ((fieldName, fieldDef) => fieldDef.description || fieldName);

    const rows = [];
    rows.push('| Field | Value |');
    rows.push('|-------|-------|');

    for (const [fieldName, fieldDef] of Object.entries(fields || {})) {
        if (hiddenFields.has(fieldName)) continue;
        const value = record[fieldName];
        const displayValue = value === undefined || value === null ? NULL_DISPLAY_VALUE : String(value);
        const label = resolveLabel(fieldName, fieldDef);
        rows.push(`| ${label} | ${displayValue} |`);
    }

    return rows.join('\n');
}

/**
 * Format a list of records as a markdown table.
 * @param {Object[]} records - Records to format
 * @param {Object} fields - Field definitions
 * @param {string} entityName - Entity name for header
 * @returns {string} Markdown table
 */
function formatRecordsTable(records, fields, entityName, options = {}) {
    if (!records || records.length === 0) {
        return `No ${entityName} records found.`;
    }
    const resolveLabel = typeof options.resolveLabel === 'function'
        ? options.resolveLabel
        : ((fieldName, fieldDef) => fieldDef.description || fieldName);

    const hiddenFields = new Set(HIDDEN_AUDIT_FIELDS);

    // Get visible field names
    const visibleFields = Object.entries(fields || {})
        .filter(([name]) => !hiddenFields.has(name));

    if (visibleFields.length === 0) return JSON.stringify(records, null, 2);

    const header = visibleFields.map(([name, def]) => resolveLabel(name, def)).join(' | ');
    const separator = visibleFields.map(() => '---').join(' | ');

    const rows = records.map(record =>
        visibleFields.map(([name]) => {
            const val = record[name];
            return val === undefined || val === null ? NULL_DISPLAY_VALUE : String(val);
        }).join(' | ')
    );

    return [
        `| ${header} |`,
        `| ${separator} |`,
        ...rows.map(r => `| ${r} |`),
    ].join('\n');
}

function escapeRegex(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripExampleHints(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    // Remove parenthesized example hints such as:
    // (e.g., "..."), (eg. "..."), (for example: ...)
    const withoutExamples = raw.replace(/\s*\((?:e\.?\s*g\.?|for example)[^)]*\)\s*/gi, ' ');
    return withoutExamples.replace(/\s+/g, ' ').trim();
}

function humanizeFieldName(fieldName) {
    const text = String(fieldName || '').trim();
    if (!text) return '';
    return text
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .replace(/\b\w/g, char => char.toUpperCase());
}

const INTERNAL_RESPONSE_FIELDS = new Set(['id']);

function sanitizeRecordForUser(record) {
    if (!record || typeof record !== 'object') return record;
    const sanitized = {};
    for (const [key, value] of Object.entries(record)) {
        if (INTERNAL_RESPONSE_FIELDS.has(key)) continue;
        sanitized[key] = value;
    }
    return sanitized;
}

function sanitizeRecordsForUser(records) {
    if (!Array.isArray(records)) return [];
    return records.map(record => sanitizeRecordForUser(record));
}

function paginateRecords(records, page = 0, pageSize = DEFAULT_SELECTION_PAGE_SIZE) {
    const normalizedRecords = Array.isArray(records) ? records : [];
    const normalizedPageSize = Number.isFinite(pageSize) && pageSize > 0
        ? Math.floor(pageSize)
        : DEFAULT_SELECTION_PAGE_SIZE;

    const total = normalizedRecords.length;
    const totalPages = Math.max(1, Math.ceil(total / normalizedPageSize));
    const rawPage = Number.isFinite(page) ? Math.floor(page) : 0;
    const safePage = Math.min(Math.max(rawPage, 0), totalPages - 1);

    const start = safePage * normalizedPageSize;
    const end = Math.min(start + normalizedPageSize, total);
    const items = normalizedRecords.slice(start, end);

    return {
        items,
        total,
        totalPages,
        page: safePage,
        pageSize: normalizedPageSize,
        start,
        end,
    };
}


export class ConversationalTskillController {
    /**
     * @param {Object} subsystem - DBTableSkillsSubsystem instance
     * @param {Object} parsedSkill - Parsed tskill.md data
     * @param {Object} functions - Generated functions (from tskill.generated.mjs)
     * @param {Object} llmAgent - LLM agent for operation parsing and filter extraction
     */
    constructor(subsystem, parsedSkill, functions, llmAgent) {
        this.subsystem = subsystem;
        this.parsedSkill = parsedSkill;
        this.functions = functions;
        this.llmAgent = llmAgent;
        this.entityName = parsedSkill.tableName || 'record';
        this.fields = parsedSkill.fields || {};
        this.primaryKey = parsedSkill.primaryKey || `${this.entityName}_id`;
    }

    requiresPrimaryKeyForCriticalOperation(operation) {
        return operation === CRUD_OPERATIONS.DELETE || operation === CRUD_OPERATIONS.UPDATE;
    }

    hasValue(value) {
        if (value === undefined || value === null) return false;
        if (typeof value === 'string' && value.trim() === '') return false;
        return true;
    }

    formatDisplayValue(value) {
        return this.hasValue(value) ? String(value) : NULL_DISPLAY_VALUE;
    }

    valuesAreEquivalent(left, right) {
        if (left === right) return true;
        if (!this.hasValue(left) && !this.hasValue(right)) return true;
        if (!this.hasValue(left) || !this.hasValue(right)) return false;
        return String(left).trim() === String(right).trim();
    }

    getFieldFullLabel(fieldName) {
        const fieldDef = this.fields?.[fieldName];
        return String(fieldDef?.description || humanizeFieldName(fieldName) || fieldName);
    }

    getFieldShortLabel(fieldName) {
        const full = this.getFieldFullLabel(fieldName);
        return stripExampleHints(full) || full;
    }

    getFieldLabel(fieldName, mode = 'short') {
        return mode === 'full'
            ? this.getFieldFullLabel(fieldName)
            : this.getFieldShortLabel(fieldName);
    }

    formatFieldLabelList(fieldNames, mode = 'short') {
        return (fieldNames || [])
            .map(fieldName => this.getFieldLabel(fieldName, mode))
            .join(', ');
    }

    sanitizeErrorTextForUser(message, mode = 'full') {
        let text = String(message || '');
        const fieldNames = Object.keys(this.fields || {});
        for (const fieldName of fieldNames) {
            const label = this.getFieldLabel(fieldName, mode);
            text = text.replace(new RegExp(`\\b${escapeRegex(fieldName)}\\b`, 'g'), label);
        }
        return text;
    }

    formatValidationErrorList(errors, mode = 'full') {
        const parts = [];
        for (const errorEntry of errors || []) {
            if (errorEntry === null || errorEntry === undefined) continue;

            if (typeof errorEntry === 'object') {
                const fieldName = errorEntry.field || errorEntry.name || null;
                const rawMessage = errorEntry.error || errorEntry.message || JSON.stringify(errorEntry);
                if (fieldName) {
                    parts.push(`${this.getFieldLabel(fieldName, mode)}: ${this.sanitizeErrorTextForUser(rawMessage, mode)}`);
                } else {
                    parts.push(this.sanitizeErrorTextForUser(rawMessage, mode));
                }
                continue;
            }

            const asString = String(errorEntry);
            try {
                const parsed = JSON.parse(asString);
                if (parsed && typeof parsed === 'object') {
                    const fieldName = parsed.field || parsed.name || null;
                    const rawMessage = parsed.error || parsed.message || asString;
                    if (fieldName) {
                        parts.push(`${this.getFieldLabel(fieldName, mode)}: ${this.sanitizeErrorTextForUser(rawMessage, mode)}`);
                    } else {
                        parts.push(this.sanitizeErrorTextForUser(rawMessage, mode));
                    }
                    continue;
                }
            } catch (_) {
                // Not JSON, continue with plain text.
            }

            parts.push(this.sanitizeErrorTextForUser(asString, mode));
        }

        return parts.join('\n- ');
    }

    isAbortCommand(prompt) {
        const text = String(prompt || '').trim().toLowerCase();
        if (!text) return false;
        return [
            'cancel',
            'abort',
            'exit',
            'quit',
            'stop',
            'close',
        ].includes(text);
    }

    getRequiredCreateFields() {
        return Object.entries(this.fields || {})
            .filter(([, fieldDef]) => Boolean(fieldDef?.isRequired))
            .map(([fieldName]) => fieldName);
    }

    getMissingRequiredFields(record, requiredFields) {
        const source = record || {};
        return (requiredFields || []).filter(fieldName => !this.hasValue(source[fieldName]));
    }

    filterKnownFields(data) {
        if (!data || typeof data !== 'object') return {};
        const knownFields = new Set([
            ...Object.keys(this.fields || {}),
            this.primaryKey,
        ]);
        const filtered = {};
        for (const [key, value] of Object.entries(data)) {
            if (knownFields.has(key)) {
                filtered[key] = value;
            }
        }
        return filtered;
    }

    getImmutableUpdateFields() {
        const immutable = new Set();
        if (this.hasValue(this.primaryKey)) {
            immutable.add(this.primaryKey);
        }
        for (const [fieldName, fieldDef] of Object.entries(this.fields || {})) {
            if (fieldDef?.isPrimaryKey) {
                immutable.add(fieldName);
            }
        }
        return Array.from(immutable);
    }

    getMutableUpdateFields() {
        const immutable = new Set(this.getImmutableUpdateFields());
        const mutable = {};
        for (const [fieldName, fieldDef] of Object.entries(this.fields || {})) {
            if (immutable.has(fieldName)) continue;
            mutable[fieldName] = fieldDef;
        }
        return mutable;
    }

    sanitizeUpdateChanges(data, options = {}) {
        const known = this.filterKnownFields(data || {});
        const immutable = new Set(this.getImmutableUpdateFields());
        const currentRecord = options?.currentRecord || null;
        const changes = {};
        const blockedFields = [];

        for (const [fieldName, value] of Object.entries(known)) {
            if (immutable.has(fieldName)) {
                const currentValue = currentRecord?.[fieldName];
                if (!this.valuesAreEquivalent(value, currentValue)) {
                    blockedFields.push(fieldName);
                }
                continue;
            }
            changes[fieldName] = value;
        }

        return {
            changes,
            blockedFields: Array.from(new Set(blockedFields)),
        };
    }

    buildImmutableUpdateNotice(blockedFields = []) {
        if (!Array.isArray(blockedFields) || blockedFields.length === 0) {
            return '';
        }
        const labels = this.formatFieldLabelList(blockedFields, 'short');
        if (blockedFields.length === 1) {
            return `This identifier field cannot be updated: **${labels}**.`;
        }
        return `These identifier fields cannot be updated: **${labels}**.`;
    }

    buildUpdateClarificationMessage(prompt, immutableNotice = '') {
        const mentionedMutableFields = this.detectMutableFieldsMentionedInPrompt(prompt);
        const immutableSection = immutableNotice ? `${immutableNotice}\n\n` : '';

        if (mentionedMutableFields.length === 1) {
            const fieldLabel = this.getFieldShortLabel(mentionedMutableFields[0]);
            return `${immutableSection}I understood you want to update **${fieldLabel}**, but I still need the new value.\n\nPlease provide the new value for **${fieldLabel}**. Example: "${fieldLabel} is \\"new value\\"".\nType **cancel** to abort.`;
        }

        if (mentionedMutableFields.length > 1) {
            const fieldsLabel = this.formatFieldLabelList(mentionedMutableFields, 'short');
            return `${immutableSection}I detected multiple fields, but I still need explicit values.\n\nFields detected: **${fieldsLabel}**.\nPlease provide field-value pairs in one message. Example: "Field A is \\"value\\", Field B is \\"value\\"".\nType **cancel** to abort.`;
        }

        return `${immutableSection}I could not determine which fields to update.\n\n${this.buildUpdateCaptureInstructions()}`;
    }

    normalizeMatchText(value) {
        return String(value || '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    getNormalizedFieldCandidates(fieldName) {
        const fieldDef = this.fields?.[fieldName] || {};
        const rawCandidates = [
            fieldName,
            this.getFieldShortLabel(fieldName),
            this.getFieldFullLabel(fieldName),
            ...(Array.isArray(fieldDef.aliases) ? fieldDef.aliases : []),
        ];
        return rawCandidates
            .map(value => this.normalizeMatchText(value))
            .filter(Boolean);
    }

    detectFieldsMentionedInPrompt(prompt, fieldNames = []) {
        const normalizedPrompt = this.normalizeMatchText(prompt);
        if (!normalizedPrompt) return [];

        const matches = [];
        for (const fieldName of fieldNames) {
            const candidates = this.getNormalizedFieldCandidates(fieldName);
            const hasMatch = candidates.some(candidate =>
                normalizedPrompt === candidate ||
                normalizedPrompt.startsWith(`${candidate} `) ||
                normalizedPrompt.endsWith(` ${candidate}`) ||
                normalizedPrompt.includes(` ${candidate} `),
            );
            if (hasMatch) {
                matches.push(fieldName);
            }
        }

        return Array.from(new Set(matches));
    }

    detectImmutableFieldsMentionedInPrompt(prompt) {
        return this.detectFieldsMentionedInPrompt(prompt, this.getImmutableUpdateFields());
    }

    detectMutableFieldsMentionedInPrompt(prompt) {
        return this.detectFieldsMentionedInPrompt(prompt, Object.keys(this.getMutableUpdateFields()));
    }

    formatCreateRequiredFieldsTable(requiredFields, record) {
        const rows = [];
        rows.push('| Field | Guidance | Status | Value |');
        rows.push('|-------|----------|--------|-------|');

        for (const fieldName of requiredFields || []) {
            const shortLabel = this.getFieldShortLabel(fieldName);
            const description = this.getFieldFullLabel(fieldName);
            const value = record?.[fieldName];
            const hasValue = this.hasValue(value);
            const status = hasValue ? 'Completed' : 'Missing';
            const displayValue = this.formatDisplayValue(value);
            rows.push(`| ${shortLabel} | ${description} | ${status} | ${displayValue} |`);
        }

        return rows.join('\n');
    }

    buildCreateCaptureMessage(pending, intro = '') {
        const requiredFields = pending?.requiredFields || [];
        const record = pending?.record || {};
        const missingFields = this.getMissingRequiredFields(record, requiredFields);
        const requiredTable = this.formatCreateRequiredFieldsTable(requiredFields, record);
        const missingLabels = this.formatFieldLabelList(missingFields, 'short');
        const missingText = missingFields.length > 0
            ? `Missing required fields: **${missingLabels}**.`
            : 'All required fields are captured.';
        const introSection = intro ? `${intro}\n\n` : '';
        const exampleFields = missingFields.length > 0 ? missingFields : requiredFields.slice(0, 2);
        const examplePairs = exampleFields.slice(0, 2).map((fieldName, index) => {
            const label = this.getFieldShortLabel(fieldName);
            const fallbackValues = ['sample value', 'another value'];
            return `${label} is "${fallbackValues[index] || 'value'}"`;
        });
        const exampleText = examplePairs.length > 0
            ? examplePairs.join(', ')
            : 'provide the missing values';

        return `${introSection}To create this ${this.entityName}, provide values for all required fields.\n\nRequired fields status:\n\n${requiredTable}\n\n${missingText}\n\nYou can provide one or more fields in a single message. Example: "${exampleText}".\nType **cancel** to abort.`;
    }

    clearCreatePendingStates(sessionMemory) {
        if (!sessionMemory) return;
        const createKey = pendingKey(this.entityName, PENDING_STATE_SUFFIXES.CREATE);
        const createCaptureKey = pendingKey(this.entityName, PENDING_STATE_SUFFIXES.CREATE_CAPTURE);
        const validationKey = pendingKey(this.entityName, PENDING_STATE_SUFFIXES.VALIDATION);

        sessionMemory.delete(createKey);
        sessionMemory.delete(createCaptureKey);

        const pendingValidation = sessionMemory.get(validationKey);
        if (pendingValidation?.operation === 'CREATE') {
            sessionMemory.delete(validationKey);
        }
    }

    clearUpdatePendingStates(sessionMemory) {
        if (!sessionMemory) return;
        const updateKey = pendingKey(this.entityName, PENDING_STATE_SUFFIXES.UPDATE);
        const updateCaptureKey = pendingKey(this.entityName, PENDING_STATE_SUFFIXES.UPDATE_CAPTURE);
        const updateTargetCaptureKey = pendingKey(this.entityName, PENDING_STATE_SUFFIXES.UPDATE_TARGET_CAPTURE);
        const validationKey = pendingKey(this.entityName, PENDING_STATE_SUFFIXES.VALIDATION);

        sessionMemory.delete(updateKey);
        sessionMemory.delete(updateCaptureKey);
        sessionMemory.delete(updateTargetCaptureKey);

        const pendingValidation = sessionMemory.get(validationKey);
        if (pendingValidation?.operation === 'UPDATE') {
            sessionMemory.delete(validationKey);
        }
    }

    buildEditableUpdateFieldsTable() {
        const mutableFields = this.getMutableUpdateFields();
        const fieldNames = Object.keys(mutableFields || {});
        if (fieldNames.length === 0) {
            return 'No editable fields are available.';
        }

        const rows = [];
        rows.push('| Editable field | Guidance |');
        rows.push('|----------------|----------|');

        for (const fieldName of fieldNames) {
            rows.push(`| ${this.getFieldShortLabel(fieldName)} | ${this.getFieldFullLabel(fieldName)} |`);
        }

        return rows.join('\n');
    }

    buildUpdateCaptureInstructions(immutableNotice = '') {
        const noticeSection = immutableNotice ? `${immutableNotice}\n\n` : '';
        const editableTable = this.buildEditableUpdateFieldsTable();
        return `${noticeSection}You can update only these fields:\n\n${editableTable}\n\nWhat would you like to change? Specify the field and new value, or type **cancel** to abort.`;
    }

    buildPrimaryKeyPrompt(
        action,
        records,
        invalidSelection = false,
        page = 0,
        pageSize = DEFAULT_SELECTION_PAGE_SIZE,
    ) {
        const primaryKeyLabel = this.getFieldShortLabel(this.primaryKey);
        const intro = invalidSelection
            ? `I couldn't find that ${primaryKeyLabel}.`
            : `Please provide the ${primaryKeyLabel} for the ${this.entityName} you want to ${action}.`;

        const sanitized = sanitizeRecordsForUser(records || []);
        const paging = paginateRecords(sanitized, page, pageSize);
        const table = formatRecordsTable(paging.items, this.fields, this.entityName, {
            resolveLabel: (fieldName) => this.getFieldLabel(fieldName, 'full'),
        });
        const from = paging.total === 0 ? 0 : paging.start + 1;
        const pageInfo = paging.totalPages > 1
            ? `Page ${paging.page + 1}/${paging.totalPages} (showing ${from}-${paging.end} of ${paging.total}). Reply **next** or **prev** to navigate pages.`
            : `Showing ${paging.total} record(s).`;

        return `${intro}\n\nAvailable ${this.entityName} records:\n\n${table}\n\n${pageInfo}\n\nReply with the exact ${primaryKeyLabel} value or type **cancel**.`;
    }

    parseNavigationCommand(prompt) {
        const text = String(prompt || '').trim().toLowerCase();
        if (!text) return null;

        const nextCommands = [
            'next',
            'n',
            'next page',
            'more',
            'show more',
            'mai mult',
            'mai multe',
            'urmator',
            'următor',
            'urmatoarea',
            'următoarea',
            'urmatoarea pagina',
            'următoarea pagină',
        ];
        const prevCommands = [
            'prev',
            'previous',
            'previous page',
            'p',
            'back',
            'anterior',
            'inapoi',
            'înapoi',
            'pagina anterioara',
            'pagina anterioară',
        ];

        const matchesCommand = (commands, value) => commands.some(command =>
            value === command || value.startsWith(`${command} `),
        );

        if (matchesCommand(nextCommands, text)) return 'next';
        if (matchesCommand(prevCommands, text)) return 'prev';
        return null;
    }

    parseSelectPaginationCommand(prompt) {
        const text = String(prompt || '').trim().toLowerCase();
        if (!text) return null;

        const showAllCommands = [
            'show all',
            'all',
            'toate',
            'arata toate',
            'arată toate',
            'afiseaza toate',
            'afișează toate',
        ];

        const matchesShowAll = showAllCommands.some(command =>
            text === command || text.startsWith(`${command} `),
        );
        if (matchesShowAll) return 'all';

        return this.parseNavigationCommand(text);
    }

    buildSelectPaginationMetadata(paging) {
        return {
            page: paging.page + 1,
            pageSize: paging.pageSize,
            totalPages: paging.totalPages,
            totalCount: paging.total,
            hasNext: paging.page < paging.totalPages - 1,
            hasPrev: paging.page > 0,
            nextCommand: 'next',
            prevCommand: 'prev',
            showAllCommand: 'show all',
        };
    }

    buildSelectPageMessage(paging) {
        const table = formatRecordsTable(paging.items, this.fields, this.entityName, {
            resolveLabel: (fieldName) => this.getFieldLabel(fieldName, 'short'),
        });
        const hasMultiplePages = paging.totalPages > 1;
        const start = paging.total === 0 ? 0 : paging.start + 1;
        const rangeText = `Showing ${start}-${paging.end} of ${paging.total} ${this.entityName}(s).`;
        const showAllHint = hasMultiplePages
            ? ' Reply **show all** to display every matching record.'
            : '';
        const guidance = hasMultiplePages
            ? `${rangeText} ${paging.page < paging.totalPages - 1 ? 'Reply **next** for more results.' : 'No more results to show.'}${paging.page > 0 ? ' Reply **prev** to go back.' : ''}${showAllHint}`
            : rangeText;
        return `Found ${paging.total} ${this.entityName}(s):\n\n${table}\n\n${guidance}`;
    }

    buildSelectAllResult(records) {
        const allRecords = Array.isArray(records) ? records : [];
        const total = allRecords.length;
        const table = formatRecordsTable(allRecords, this.fields, this.entityName, {
            resolveLabel: (fieldName) => this.getFieldLabel(fieldName, 'short'),
        });
        return {
            success: true,
            operation: 'SELECT',
            records: allRecords,
            count: total,
            totalCount: total,
            pagination: {
                page: 1,
                pageSize: total,
                totalPages: 1,
                totalCount: total,
                hasNext: false,
                hasPrev: false,
                nextCommand: 'next',
                prevCommand: 'prev',
                showAllCommand: 'show all',
            },
            requiresInput: false,
            renderRecordsTable: false,
            message: `Found ${total} ${this.entityName}(s):\n\n${table}\n\nShowing all ${total} ${this.entityName}(s).`,
        };
    }

    buildSelectPageResult(records, page = 0, pageSize = DEFAULT_SELECTION_PAGE_SIZE, boundaryMessage = '') {
        const paging = paginateRecords(records || [], page, pageSize);
        const message = boundaryMessage
            ? `${boundaryMessage}\n\n${this.buildSelectPageMessage(paging)}`
            : this.buildSelectPageMessage(paging);
        const pagination = this.buildSelectPaginationMetadata(paging);

        return {
            success: true,
            operation: 'SELECT',
            records: paging.items,
            count: paging.items.length,
            totalCount: paging.total,
            pagination,
            requiresInput: pagination.hasNext,
            renderRecordsTable: false,
            message,
        };
    }

    async handleSelectPagination(prompt, pending, sessionMemory, key) {
        const text = String(prompt || '').trim();
        if (!text) {
            return this.buildSelectPageResult(
                pending.records || [],
                pending.page || 0,
                pending.pageSize || DEFAULT_SELECTION_PAGE_SIZE,
            );
        }

        if (isNoResponse(prompt) || /^cancel$/i.test(text) || /^(stop|close)$/i.test(text.toLowerCase())) {
            sessionMemory.delete(key);
            return {
                success: true,
                operation: 'SELECT',
                cancelled: true,
                message: 'Pagination closed.',
            };
        }

        const paginationCommand = this.parseSelectPaginationCommand(prompt);
        if (!paginationCommand) {
            // Non-navigation input should continue as a fresh request.
            sessionMemory.delete(key);
            return null;
        }

        if (paginationCommand === 'all') {
            sessionMemory.delete(key);
            return this.buildSelectAllResult(pending.records || []);
        }

        const paging = paginateRecords(
            pending.records || [],
            pending.page || 0,
            pending.pageSize || DEFAULT_SELECTION_PAGE_SIZE,
        );

        let nextPage = paging.page;
        if (paginationCommand === 'next' && nextPage < paging.totalPages - 1) nextPage++;
        if (paginationCommand === 'prev' && nextPage > 0) nextPage--;

        pending.page = nextPage;
        pending.pageSize = paging.pageSize;
        sessionMemory.set(key, pending);

        const atBoundary = nextPage === paging.page && paging.totalPages > 1;
        const boundaryMessage = atBoundary
                ? `You're already on ${paginationCommand === 'next' ? 'the last' : 'the first'} page.`
                : '';

        return this.buildSelectPageResult(
            pending.records || [],
            pending.page,
            pending.pageSize,
            boundaryMessage,
        );
    }

    extractPrimaryKeyFromPrompt(prompt, records) {
        const text = String(prompt || '').trim();
        if (!text) return null;

        const recordsWithIds = (records || []).filter(record => this.hasValue(record?.[this.primaryKey]));
        if (recordsWithIds.length === 0) return null;

        const direct = recordsWithIds.find(record => String(record[this.primaryKey]).toLowerCase() === text.toLowerCase());
        if (direct) return direct[this.primaryKey];

        for (const record of recordsWithIds) {
            const id = String(record[this.primaryKey]);
            const regex = new RegExp(`\\b${escapeRegex(id)}\\b`, 'i');
            if (regex.test(text)) return record[this.primaryKey];
        }

        return null;
    }

    /**
     * Write progress message using context I/O or global IOServices.
     * Checks context.io.outputWriter first, falls back to IOServices.
     * Falls back silently if no output writer is configured.
     * @param {string} message - The progress message to write.
     * @returns {Promise<void>}
     */
    async writeProgress(message) {
        // Check context I/O first (injected by RecursiveSkilledAgent)
        const contextWriter = this._currentContext?.io?.outputWriter;
        const writer = contextWriter || IOServices.getOutputWriter();
        if (writer && typeof writer.writeProgress === 'function') {
            await writer.writeProgress(message);
        }
    }

    /**
     * Main entry point. Checks for pending state first, then routes to the
     * appropriate CRUD flow.
     *
     * @param {string} prompt - User's natural language input
     * @param {Object} context - Execution context
     * @param {Map} context.sessionMemory - Session memory for pending state
     * @param {Object} [context.io] - I/O services (inputReader, outputWriter)
     * @returns {Promise<Object>} Result with { success, message, operation, ... }
     */
    async execute(prompt, context) {
        // Store context for use in helper methods (e.g., writeProgress)
        this._currentContext = context;
        
        const { sessionMemory } = context || {};

        // 1. Check for pending state first
        if (sessionMemory) {
            const pendingResult = await this.handlePendingState(prompt, sessionMemory);
            if (pendingResult) return pendingResult;
        }

        // 2. Parse the operation from the user's prompt
        await this.writeProgress(`Analyzing request for ${this.entityName}...`);
        const operation = await this.parseOperation(prompt);

        // 3. Create execution context with DB operations
        const execContext = this.subsystem.createExecutionContext(
            this.functions,
            this.entityName,
        );

        // 4. Route to the appropriate flow
        await this.writeProgress(`Executing ${operation.operation} operation...`);
        switch (operation.operation) {
            case CRUD_OPERATIONS.CREATE:
                return this.createFlow(operation, execContext, sessionMemory);
            case CRUD_OPERATIONS.UPDATE:
                return this.updateFlow(operation, execContext, sessionMemory);
            case CRUD_OPERATIONS.DELETE:
                return this.deleteFlow(operation, execContext, sessionMemory);
            case CRUD_OPERATIONS.SELECT:
                return this.selectFlow(operation, execContext, sessionMemory);
            default:
                return {
                    success: false,
                    operation: operation.operation || 'UNKNOWN',
                    message: `Unknown operation: ${operation.operation}`,
                };
        }
    }

    // =============================================
    // PENDING STATE HANDLING
    // =============================================

    /**
     * Check all pending states and handle the user's response.
     * Returns a result if a pending state was found, null otherwise.
     */
    async handlePendingState(prompt, sessionMemory) {
        // Create confirmation
        const createKey = pendingKey(this.entityName, PENDING_STATE_SUFFIXES.CREATE);
        const pendingCreate = sessionMemory.get(createKey);
        if (pendingCreate) {
            return this.handleCreateConfirmation(prompt, pendingCreate, sessionMemory, createKey);
        }

        // Create required-field capture
        const createCaptureKey = pendingKey(this.entityName, PENDING_STATE_SUFFIXES.CREATE_CAPTURE);
        const pendingCreateCapture = sessionMemory.get(createCaptureKey);
        if (pendingCreateCapture) {
            return this.handleCreateFieldCapture(prompt, pendingCreateCapture, sessionMemory, createCaptureKey);
        }

        // Update confirmation
        const updateKey = pendingKey(this.entityName, PENDING_STATE_SUFFIXES.UPDATE);
        const pendingUpdate = sessionMemory.get(updateKey);
        if (pendingUpdate) {
            return this.handleUpdateConfirmation(prompt, pendingUpdate, sessionMemory, updateKey);
        }

        // Update target capture (user must provide primary key to update)
        const updateTargetCaptureKey = pendingKey(this.entityName, PENDING_STATE_SUFFIXES.UPDATE_TARGET_CAPTURE);
        const pendingUpdateTargetCapture = sessionMemory.get(updateTargetCaptureKey);
        if (pendingUpdateTargetCapture) {
            return this.handleUpdateTargetCapture(prompt, pendingUpdateTargetCapture, sessionMemory, updateTargetCaptureKey);
        }

        // Update field capture (user is specifying what to change)
        const captureKey = pendingKey(this.entityName, PENDING_STATE_SUFFIXES.UPDATE_CAPTURE);
        const pendingCapture = sessionMemory.get(captureKey);
        if (pendingCapture) {
            return this.handleUpdateFieldCapture(prompt, pendingCapture, sessionMemory, captureKey);
        }

        // Delete id capture (user must provide primary key to delete)
        const deleteCaptureKey = pendingKey(this.entityName, PENDING_STATE_SUFFIXES.DELETE_CAPTURE);
        const pendingDeleteCapture = sessionMemory.get(deleteCaptureKey);
        if (pendingDeleteCapture) {
            return this.handleDeleteIdCapture(prompt, pendingDeleteCapture, sessionMemory, deleteCaptureKey);
        }

        // Delete confirmation
        const deleteKey = pendingKey(this.entityName, PENDING_STATE_SUFFIXES.DELETE);
        const pendingDelete = sessionMemory.get(deleteKey);
        if (pendingDelete) {
            return this.handleDeleteConfirmation(prompt, pendingDelete, sessionMemory, deleteKey);
        }

        // Validation corrections
        const validationKey = pendingKey(this.entityName, PENDING_STATE_SUFFIXES.VALIDATION);
        const pendingValidation = sessionMemory.get(validationKey);
        if (pendingValidation) {
            return this.handleValidationCorrections(prompt, pendingValidation, sessionMemory, validationKey);
        }

        // Select pagination (next/prev navigation over large SELECT results)
        const selectPaginationKey = pendingKey(this.entityName, PENDING_STATE_SUFFIXES.SELECT_PAGINATION);
        const pendingSelectPagination = sessionMemory.get(selectPaginationKey);
        if (pendingSelectPagination) {
            sessionMemory.delete(selectPaginationKey);
        }

        return null;
    }

    async extractCreateDataFromInput(prompt, pending) {
        const fieldInfo = formatFieldInfo(this.fields);
        const extractionPrompt = buildExtractCreateDataPrompt(
            this.entityName,
            pending?.record || {},
            pending?.requiredFields || [],
            pending?.missingFields || [],
            fieldInfo,
            prompt,
        );

        const extracted = await this.llmAgent.executePrompt(extractionPrompt, {
            mode: 'fast',
            responseShape: 'json',
        });

        return this.filterKnownFields(extracted?.data || {});
    }

    async prepareCreateForConfirmation(record, execContext, sessionMemory) {
        const validation = execContext.validateRecord
            ? await execContext.validateRecord(record)
            : { isValid: true, errors: [] };

        if (!validation.isValid) {
            if (sessionMemory) {
                sessionMemory.set(pendingKey(this.entityName, PENDING_STATE_SUFFIXES.VALIDATION), {
                    operation: 'CREATE',
                    record,
                    errors: validation.errors,
                });
            }
            const errorList = this.formatValidationErrorList(validation.errors, 'full');
            return {
                success: false,
                operation: 'CREATE',
                message: `Validation errors:\n- ${errorList}\n\nPlease provide corrections or type **cancel** to abort.`,
            };
        }

        if (sessionMemory) {
            sessionMemory.set(pendingKey(this.entityName, PENDING_STATE_SUFFIXES.CREATE), {
                record,
            });
        }

        const table = formatRecordTable(record, this.fields);
        return {
            success: true,
            operation: 'CREATE',
            requiresConfirmation: true,
            message: `Create ${this.entityName}:\n\n${table}\n\nReply **yes** to confirm or **no** to cancel.`,
        };
    }

    async handleCreateFieldCapture(prompt, pending, sessionMemory, key) {
        if (this.isAbortCommand(prompt)) {
            this.clearCreatePendingStates(sessionMemory);
            return {
                success: true,
                operation: 'CREATE',
                message: 'Create cancelled.',
                cancelled: true,
            };
        }

        const execContext = this.subsystem.createExecutionContext(
            this.functions,
            this.entityName,
        );

        let extractedData = {};
        try {
            extractedData = await this.extractCreateDataFromInput(prompt, pending);
        } catch (error) {
            sessionMemory.set(key, pending);
            return {
                success: false,
                operation: 'CREATE',
                requiresInput: true,
                message: `${this.buildCreateCaptureMessage(pending, 'I could not process that input.')}\n\nDetails: ${error.message}`,
            };
        }

        if (Object.keys(extractedData).length === 0) {
            sessionMemory.set(key, pending);
            return {
                success: true,
                operation: 'CREATE',
                requiresInput: true,
                message: this.buildCreateCaptureMessage(
                    pending,
                    'I could not identify any field values in your message.',
                ),
            };
        }

        const mergedRecord = { ...(pending.record || {}), ...extractedData };
        const prepared = execContext.prepareRecord
            ? await execContext.prepareRecord(mergedRecord)
            : mergedRecord;

        const requiredFields = pending.requiredFields || this.getRequiredCreateFields();
        const missingFields = this.getMissingRequiredFields(prepared, requiredFields);
        const capturedFields = this.formatFieldLabelList(Object.keys(extractedData), 'short');

        if (missingFields.length > 0) {
            const nextPending = {
                record: prepared,
                requiredFields,
                missingFields,
            };
            sessionMemory.set(key, nextPending);
            return {
                success: true,
                operation: 'CREATE',
                requiresInput: true,
                message: this.buildCreateCaptureMessage(
                    nextPending,
                    `Captured field values: ${capturedFields}.`,
                ),
            };
        }

        sessionMemory.delete(key);
        return this.prepareCreateForConfirmation(prepared, execContext, sessionMemory);
    }

    async handleCreateConfirmation(prompt, pending, sessionMemory, key) {
        if (this.isAbortCommand(prompt)) {
            this.clearCreatePendingStates(sessionMemory);
            return {
                success: true,
                operation: 'CREATE',
                message: 'Create cancelled.',
                cancelled: true,
            };
        }

        const decision = await resolveConfirmation(prompt, this.llmAgent, {
            actionContext: `confirming creation of ${this.entityName}`,
        });

        if (decision === 'yes') {
            sessionMemory.delete(key);
            // Execute the insert
            await this.writeProgress(`Creating ${this.entityName}...`);
            const execContext = this.subsystem.createExecutionContext(
                this.functions, this.entityName,
            );
            try {
                const insertResult = await execContext.insertRecord(pending.record);
                const inserted = { ...pending.record, ...insertResult };
                const presented = execContext.presentRecord
                    ? await execContext.presentRecord(inserted)
                    : inserted;
                const safeRecord = sanitizeRecordForUser(presented);
                return {
                    success: true,
                    operation: 'CREATE',
                    record: safeRecord,
                    message: `${this.entityName} created successfully.`,
                };
            } catch (error) {
                return {
                    success: false,
                    operation: 'CREATE',
                    message: `Failed to create ${this.entityName}: ${error.message}`,
                };
            }
        }

        if (decision === 'no') {
            sessionMemory.delete(key);
            return {
                success: true,
                operation: 'CREATE',
                message: 'Operation cancelled.',
                cancelled: true,
            };
        }

        // Unclear
        return {
            success: true,
            operation: 'CREATE',
            message: `Please reply **yes** to create the ${this.entityName} or **no** to cancel.`,
        };
    }

    async handleUpdateConfirmation(prompt, pending, sessionMemory, key) {
        const decision = await resolveConfirmation(prompt, this.llmAgent, {
            actionContext: `confirming update of ${this.entityName}`,
        });

        if (decision === 'yes') {
            sessionMemory.delete(key);
            await this.writeProgress(`Updating ${this.entityName}...`);
            const execContext = this.subsystem.createExecutionContext(
                this.functions, this.entityName,
            );
            try {
                const recordId = pending.id;
                const updateResult = await execContext.updateRecord(recordId, pending.changes);
                const updated = { ...pending.original, ...pending.changes, ...updateResult };
                const presented = execContext.presentRecord
                    ? await execContext.presentRecord(updated)
                    : updated;
                const safeRecord = sanitizeRecordForUser(presented);
                return {
                    success: true,
                    operation: 'UPDATE',
                    record: safeRecord,
                    message: `${this.entityName} updated successfully.`,
                };
            } catch (error) {
                const details = error?.message || String(error);
                const dependencyConflict = /(foreign key|constraint|referenc|dependent|violat)/i.test(details);
                return {
                    success: false,
                    operation: 'UPDATE',
                    blockedByDependencies: dependencyConflict,
                    message: dependencyConflict
                        ? `Update blocked because this ${this.entityName} is referenced or constrained by related records. Details: ${details}`
                        : `Failed to update ${this.entityName}: ${details}`,
                };
            }
        }

        if (decision === 'no') {
            sessionMemory.delete(key);
            return {
                success: true,
                operation: 'UPDATE',
                message: 'Update cancelled.',
                cancelled: true,
            };
        }

        return {
            success: true,
            operation: 'UPDATE',
            message: `Please reply **yes** to apply the changes or **no** to cancel.`,
        };
    }

    async prepareUpdateForRecord(record, changes, execContext, sessionMemory, options = {}) {
        const recordId = record[this.primaryKey];
        const hasChanges = Object.keys(changes || {}).length > 0;
        const immutableNotice = this.buildImmutableUpdateNotice(options?.blockedFields || []);

        if (!hasChanges) {
            // No changes specified — show current record and ask what to change
            if (sessionMemory) {
                sessionMemory.set(pendingKey(this.entityName, PENDING_STATE_SUFFIXES.UPDATE_CAPTURE), {
                    id: recordId,
                    record,
                });
            }
            const presented = execContext.presentRecord
                ? await execContext.presentRecord(record)
                : record;
            const safeRecord = sanitizeRecordForUser(presented);
            const table = formatRecordTable(safeRecord, this.fields);
            return {
                success: true,
                operation: 'UPDATE',
                requiresInput: true,
                message: `Current ${this.entityName} ${recordId}:\n\n${table}\n\n${this.buildUpdateCaptureInstructions(immutableNotice)}`,
            };
        }

        // Has changes — validate
        const patched = { ...record, ...changes };
        const prepared = execContext.prepareRecord
            ? await execContext.prepareRecord(patched)
            : patched;
        const validation = execContext.validateRecord
            ? await execContext.validateRecord(prepared)
            : { isValid: true, errors: [] };

        if (!validation.isValid) {
            if (sessionMemory) {
                sessionMemory.set(pendingKey(this.entityName, PENDING_STATE_SUFFIXES.VALIDATION), {
                    operation: 'UPDATE',
                    record,
                    changes,
                    id: recordId,
                    errors: validation.errors,
                    blockedFields: options?.blockedFields || [],
                });
            }
            const errorList = this.formatValidationErrorList(validation.errors, 'full');
            const noticeSection = immutableNotice ? `${immutableNotice}\n\n` : '';
            return {
                success: false,
                operation: 'UPDATE',
                message: `${noticeSection}Validation errors:\n- ${errorList}\n\nPlease provide corrections or type **cancel** to abort.`,
            };
        }

        // Show changes and ask for confirmation
        if (sessionMemory) {
            sessionMemory.set(pendingKey(this.entityName, PENDING_STATE_SUFFIXES.UPDATE), {
                id: recordId,
                original: record,
                changes: prepared,
            });
        }

        const changeTable = Object.entries(changes)
            .map(([field, value]) => {
                const label = this.getFieldLabel(field, 'full');
                return `| ${label} | ${this.formatDisplayValue(record[field])} | ${this.formatDisplayValue(value)} |`;
            })
            .join('\n');

        return {
            success: true,
            operation: 'UPDATE',
            requiresConfirmation: true,
            message: `${immutableNotice ? `${immutableNotice}\n\n` : ''}Update ${this.entityName} ${recordId}:\n\n| Field | Current | New |\n|-------|---------|-----|\n${changeTable}\n\nReply **yes** to apply or **no** to cancel.`,
        };
    }

    async handleUpdateTargetCapture(prompt, pending, sessionMemory, key) {
        if (isNoResponse(prompt) || this.isAbortCommand(prompt)) {
            this.clearUpdatePendingStates(sessionMemory);
            return {
                success: true,
                operation: 'UPDATE',
                message: 'Update cancelled.',
                cancelled: true,
            };
        }

        const navigation = this.parseNavigationCommand(prompt);
        if (navigation) {
            const paging = paginateRecords(
                pending.records || [],
                pending.page || 0,
                pending.pageSize || DEFAULT_SELECTION_PAGE_SIZE,
            );

            let nextPage = paging.page;
            if (navigation === 'next' && nextPage < paging.totalPages - 1) nextPage++;
            if (navigation === 'prev' && nextPage > 0) nextPage--;

            pending.page = nextPage;
            pending.pageSize = paging.pageSize;
            sessionMemory.set(key, pending);

            const atBoundary = nextPage === paging.page && paging.totalPages > 1;
            const boundaryMessage = atBoundary
                ? `You're already on ${navigation === 'next' ? 'the last' : 'the first'} page.\n\n`
                : '';

            return {
                success: true,
                operation: 'UPDATE',
                requiresInput: true,
                message: `${boundaryMessage}${this.buildPrimaryKeyPrompt('update', pending.records, false, pending.page, pending.pageSize)}`,
            };
        }

        const targetId = this.extractPrimaryKeyFromPrompt(prompt, pending.records);
        if (!this.hasValue(targetId)) {
            return {
                success: true,
                operation: 'UPDATE',
                requiresInput: true,
                message: this.buildPrimaryKeyPrompt('update', pending.records, true, pending.page || 0, pending.pageSize || DEFAULT_SELECTION_PAGE_SIZE),
            };
        }

        const selectedRecord = (pending.records || []).find(record =>
            String(record?.[this.primaryKey]).toLowerCase() === String(targetId).toLowerCase(),
        );
        if (!selectedRecord) {
            return {
                success: true,
                operation: 'UPDATE',
                requiresInput: true,
                message: this.buildPrimaryKeyPrompt('update', pending.records, true, pending.page || 0, pending.pageSize || DEFAULT_SELECTION_PAGE_SIZE),
            };
        }

        sessionMemory.delete(key);
        const execContext = this.subsystem.createExecutionContext(
            this.functions,
            this.entityName,
        );
        return this.prepareUpdateForRecord(
            selectedRecord,
            pending.changes || {},
            execContext,
            sessionMemory,
            { blockedFields: pending.blockedFields || [] },
        );
    }

    async handleUpdateFieldCapture(prompt, pending, sessionMemory, key) {
        if (this.isAbortCommand(prompt)) {
            this.clearUpdatePendingStates(sessionMemory);
            return {
                success: true,
                operation: 'UPDATE',
                message: 'Update cancelled.',
                cancelled: true,
            };
        }

        // The user is specifying what fields to change.
        // Use LLM to extract field changes from the prompt.
        sessionMemory.delete(key);

        const fieldInfo = formatFieldInfoSimple(this.getMutableUpdateFields());
        const extractPrompt = buildExtractFieldChangesPrompt(
            this.entityName,
            pending.record,
            fieldInfo,
            prompt,
        );

        try {
            const extracted = await this.llmAgent.executePrompt(extractPrompt, {
                mode: 'fast',
                responseShape: 'json',
            });

            const {
                changes,
                blockedFields: extractedBlockedFields,
            } = this.sanitizeUpdateChanges(extracted?.changes || {}, {
                currentRecord: pending.record,
            });
            const mentionedBlockedFields = this.detectImmutableFieldsMentionedInPrompt(prompt);
            const blockedFields = Array.from(new Set([
                ...(Array.isArray(extractedBlockedFields) ? extractedBlockedFields : []),
                ...(Array.isArray(mentionedBlockedFields) ? mentionedBlockedFields : []),
            ]));
            const blockedFieldsForNoChangeNotice = Array.from(new Set(
                Array.isArray(mentionedBlockedFields) ? mentionedBlockedFields : [],
            ));
            const immutableNotice = this.buildImmutableUpdateNotice(
                Object.keys(changes).length === 0 ? blockedFieldsForNoChangeNotice : blockedFields,
            );
            if (Object.keys(changes).length === 0) {
                if (sessionMemory) {
                    sessionMemory.set(key, pending);
                }
                return {
                    success: true,
                    operation: 'UPDATE',
                    requiresInput: true,
                    message: this.buildUpdateClarificationMessage(prompt, immutableNotice),
                };
            }

            // Validate changes
            const execContext = this.subsystem.createExecutionContext(
                this.functions, this.entityName,
            );
            const patched = { ...pending.record, ...changes };
            const prepared = execContext.prepareRecord
                ? await execContext.prepareRecord(patched)
                : patched;
            const validation = execContext.validateRecord
                ? await execContext.validateRecord(prepared)
                : { isValid: true, errors: [] };

            if (!validation.isValid) {
                // Store for corrections
                sessionMemory.set(pendingKey(this.entityName, PENDING_STATE_SUFFIXES.VALIDATION), {
                    operation: 'UPDATE',
                    record: pending.record,
                    changes,
                    id: pending.id,
                    errors: validation.errors,
                    blockedFields,
                });
                const errorList = this.formatValidationErrorList(validation.errors, 'full');
                return {
                    success: false,
                    operation: 'UPDATE',
                    message: `${immutableNotice ? `${immutableNotice}\n\n` : ''}Validation errors:\n- ${errorList}\n\nPlease provide corrections or type **cancel** to abort.`,
                };
            }

            // Show confirmation
            const changeTable = Object.entries(changes)
                .map(([field, value]) => {
                    const label = this.getFieldLabel(field, 'full');
                    return `| ${label} | ${this.formatDisplayValue(pending.record[field])} | ${this.formatDisplayValue(value)} |`;
                })
                .join('\n');

            const updateKey = pendingKey(this.entityName, PENDING_STATE_SUFFIXES.UPDATE);
            sessionMemory.set(updateKey, {
                id: pending.id,
                original: pending.record,
                changes: prepared,
            });

            return {
                success: true,
                operation: 'UPDATE',
                requiresConfirmation: true,
                message: `${immutableNotice ? `${immutableNotice}\n\n` : ''}Proposed changes for ${this.entityName} ${pending.id}:\n\n| Field | Current | New |\n|-------|---------|-----|\n${changeTable}\n\nReply **yes** to apply or **no** to cancel.`,
            };
        } catch (error) {
            if (sessionMemory) {
                sessionMemory.set(key, pending);
            }
            return {
                success: false,
                operation: 'UPDATE',
                requiresInput: true,
                message: `I could not process that update request.\n\n${this.buildUpdateCaptureInstructions()}\n\nDetails: ${error.message}`,
            };
        }
    }

    async handleDeleteIdCapture(prompt, pending, sessionMemory, key) {
        if (isNoResponse(prompt) || /^cancel$/i.test(String(prompt || '').trim())) {
            sessionMemory.delete(key);
            return {
                success: true,
                operation: 'DELETE',
                message: 'Delete cancelled.',
                cancelled: true,
            };
        }

        const navigation = this.parseNavigationCommand(prompt);
        if (navigation) {
            const paging = paginateRecords(
                pending.records || [],
                pending.page || 0,
                pending.pageSize || DEFAULT_SELECTION_PAGE_SIZE,
            );

            let nextPage = paging.page;
            if (navigation === 'next' && nextPage < paging.totalPages - 1) nextPage++;
            if (navigation === 'prev' && nextPage > 0) nextPage--;

            pending.page = nextPage;
            pending.pageSize = paging.pageSize;
            sessionMemory.set(key, pending);

            const atBoundary = nextPage === paging.page && paging.totalPages > 1;
            const boundaryMessage = atBoundary
                ? `You're already on ${navigation === 'next' ? 'the last' : 'the first'} page.\n\n`
                : '';

            return {
                success: true,
                operation: 'DELETE',
                requiresInput: true,
                message: `${boundaryMessage}${this.buildPrimaryKeyPrompt('delete', pending.records, false, pending.page, pending.pageSize)}`,
            };
        }

        const targetId = this.extractPrimaryKeyFromPrompt(prompt, pending.records);
        if (!this.hasValue(targetId)) {
            return {
                success: true,
                operation: 'DELETE',
                requiresInput: true,
                message: this.buildPrimaryKeyPrompt('delete', pending.records, true, pending.page || 0, pending.pageSize || DEFAULT_SELECTION_PAGE_SIZE),
            };
        }

        const selectedRecord = (pending.records || []).find(record =>
            String(record?.[this.primaryKey]).toLowerCase() === String(targetId).toLowerCase(),
        );

        if (!selectedRecord) {
            return {
                success: true,
                operation: 'DELETE',
                requiresInput: true,
                message: this.buildPrimaryKeyPrompt('delete', pending.records, true, pending.page || 0, pending.pageSize || DEFAULT_SELECTION_PAGE_SIZE),
            };
        }

        sessionMemory.delete(key);
        sessionMemory.set(pendingKey(this.entityName, PENDING_STATE_SUFFIXES.DELETE), {
            records: [selectedRecord],
        });

        const execContext = this.subsystem.createExecutionContext(
            this.functions,
            this.entityName,
        );
        const presented = execContext.presentRecord
            ? await execContext.presentRecord(selectedRecord)
            : selectedRecord;
        const safeRecord = sanitizeRecordForUser(presented);
        const table = formatRecordsTable([safeRecord], this.fields, this.entityName);

        return {
            success: true,
            operation: 'DELETE',
            requiresConfirmation: true,
            message: `About to delete 1 ${this.entityName} record:\n\n${table}\n\nReply **yes** to confirm or **no** to cancel.`,
        };
    }

    async handleDeleteConfirmation(prompt, pending, sessionMemory, key) {
        const decision = await resolveConfirmation(prompt, this.llmAgent, {
            actionContext: `confirming deletion of ${this.entityName}`,
        });

        if (decision === 'yes') {
            sessionMemory.delete(key);
            await this.writeProgress(`Deleting ${this.entityName} record(s)...`);
            const execContext = this.subsystem.createExecutionContext(
                this.functions, this.entityName,
            );
            try {
                const deleted = [];
                for (const record of pending.records) {
                    const recordId = record[this.primaryKey];
                    await execContext.deleteRecord(recordId);
                    deleted.push(recordId);
                }
                return {
                    success: true,
                    operation: 'DELETE',
                    message: `Deleted ${deleted.length} ${this.entityName} record(s).`,
                    count: deleted.length,
                };
            } catch (error) {
                const details = error?.message || String(error);
                const dependencyConflict = /(foreign key|constraint|referenc|dependent|violat)/i.test(details);
                return {
                    success: false,
                    operation: 'DELETE',
                    blockedByDependencies: dependencyConflict,
                    message: dependencyConflict
                        ? `Delete blocked because this ${this.entityName} is referenced by related records in other tables. Details: ${details}`
                        : `Failed to delete ${this.entityName}: ${details}`,
                };
            }
        }

        if (decision === 'no') {
            sessionMemory.delete(key);
            return {
                success: true,
                operation: 'DELETE',
                message: 'Delete cancelled.',
                cancelled: true,
            };
        }

        return {
            success: true,
            operation: 'DELETE',
            message: `Please reply **yes** to delete or **no** to cancel.`,
        };
    }

    async handleValidationCorrections(prompt, pending, sessionMemory, key) {
        // Check for cancel/abort
        const trimmedPrompt = String(prompt || '').trim();
        const shouldAbort = isNoResponse(prompt) || /^cancel$/i.test(trimmedPrompt) || this.isAbortCommand(trimmedPrompt);
        if (shouldAbort) {
            if (pending.operation === 'CREATE') {
                this.clearCreatePendingStates(sessionMemory);
            } else {
                sessionMemory.delete(key);
            }
            return {
                success: true,
                operation: pending.operation,
                message: 'Operation cancelled.',
                cancelled: true,
            };
        }

        // Use LLM to apply corrections
        sessionMemory.delete(key);

        const errorList = this.formatValidationErrorList(pending.errors || [], 'full');

        const correctionFields = pending.operation === 'UPDATE'
            ? this.getMutableUpdateFields()
            : this.fields;
        const fieldInfo = formatFieldInfoSimple(correctionFields);
        const correctionPrompt = buildValidationCorrectionPrompt(
            this.entityName,
            errorList,
            pending.changes || pending.record,
            prompt,
            fieldInfo,
        );

        try {
            const result = await this.llmAgent.executePrompt(correctionPrompt, {
                mode: 'fast',
                responseShape: 'json',
            });
            let corrected = result?.correctedData || {};
            let blockedFields = Array.isArray(pending.blockedFields)
                ? [...pending.blockedFields]
                : [];

            if (pending.operation === 'UPDATE') {
                const merged = {
                    ...(pending.record || {}),
                    ...(corrected || {}),
                };
                const sanitized = this.sanitizeUpdateChanges(merged, {
                    currentRecord: pending.record,
                });
                corrected = {
                    ...(pending.record || {}),
                    ...sanitized.changes,
                };
                blockedFields = Array.from(new Set([
                    ...blockedFields,
                    ...(sanitized.blockedFields || []),
                ]));
            }

            const immutableNotice = this.buildImmutableUpdateNotice(blockedFields);

            // Re-validate
            const execContext = this.subsystem.createExecutionContext(
                this.functions, this.entityName,
            );
            const prepared = execContext.prepareRecord
                ? await execContext.prepareRecord(corrected)
                : corrected;
            const validation = execContext.validateRecord
                ? await execContext.validateRecord(prepared)
                : { isValid: true, errors: [] };

            if (!validation.isValid) {
                // Still invalid, ask again
                sessionMemory.set(key, {
                    ...pending,
                    changes: corrected,
                    errors: validation.errors,
                    blockedFields,
                });
                const newErrors = this.formatValidationErrorList(validation.errors, 'full');
                return {
                    success: false,
                    operation: pending.operation,
                    message: `${immutableNotice ? `${immutableNotice}\n\n` : ''}Still has validation errors:\n- ${newErrors}\n\nPlease provide corrections or type **cancel** to abort.`,
                };
            }

            // Valid — proceed based on operation type
            if (pending.operation === 'CREATE') {
                const createKey = pendingKey(this.entityName, PENDING_STATE_SUFFIXES.CREATE);
                sessionMemory.set(createKey, { record: prepared });
                const table = formatRecordTable(prepared, this.fields);
                return {
                    success: true,
                    operation: 'CREATE',
                    requiresConfirmation: true,
                    message: `Create ${this.entityName}:\n\n${table}\n\nReply **yes** to confirm or **no** to cancel.`,
                };
            }

            if (pending.operation === 'UPDATE') {
                const updateKey = pendingKey(this.entityName, PENDING_STATE_SUFFIXES.UPDATE);
                sessionMemory.set(updateKey, {
                    id: pending.id,
                    original: pending.record,
                    changes: prepared,
                });
                return {
                    success: true,
                    operation: 'UPDATE',
                    requiresConfirmation: true,
                    message: `${immutableNotice ? `${immutableNotice}\n\n` : ''}Updated data is valid.\n\nReply **yes** to apply changes or **no** to cancel.`,
                };
            }
        } catch (error) {
            return {
                success: false,
                operation: pending.operation,
                message: `Failed to process corrections: ${error.message}`,
            };
        }
    }

    // =============================================
    // CRUD FLOWS
    // =============================================

    /**
     * Parse the user's prompt to determine the CRUD operation.
     */
    async parseOperation(prompt) {
        const fieldInfo = formatFieldInfo(this.fields);
        const operationPrompt = buildParseOperationPrompt(
            prompt,
            this.entityName,
            this.parsedSkill.tablePurpose,
            fieldInfo,
            this.parsedSkill.instructions || '',
        );

        return this.llmAgent.executePrompt(operationPrompt, {
            mode: 'fast',
            responseShape: 'json',
        });
    }

    /**
     * CREATE flow:
     * - capture required fields if missing
     * - validate final record
     * - ask confirmation before insert
     */
    async createFlow(operation, execContext, sessionMemory) {
        const newRecord = this.filterKnownFields(operation.data || {});
        // Generate primary key only if caller did not provide one
        if (execContext.generatePKValues) {
            try {
                const hasPrimaryKey = Boolean(
                    this.primaryKey &&
                    newRecord[this.primaryKey] !== undefined &&
                    newRecord[this.primaryKey] !== null &&
                    newRecord[this.primaryKey] !== ''
                );
                if (!hasPrimaryKey) {
                    let existingRecords = [];
                    if (execContext.selectRecords) {
                        try {
                            existingRecords = await execContext.selectRecords({});
                        } catch (_ignored) {
                    existingRecords = [];
                        }
                    }
                    const pkValues = execContext.generatePKValues(newRecord, existingRecords);
                    Object.assign(newRecord, pkValues);
                }
            } catch (_e) {
                // PK generation is optional
            }
        }

        // Prepare record
        const prepared = execContext.prepareRecord
            ? await execContext.prepareRecord(newRecord)
            : newRecord;

        const requiredFields = this.getRequiredCreateFields();
        const missingFields = this.getMissingRequiredFields(prepared, requiredFields);
        if (missingFields.length > 0) {
            if (sessionMemory) {
                sessionMemory.set(pendingKey(this.entityName, PENDING_STATE_SUFFIXES.CREATE_CAPTURE), {
                    record: prepared,
                    requiredFields,
                    missingFields,
                });
            }
            return {
                success: true,
                operation: 'CREATE',
                requiresInput: true,
                message: this.buildCreateCaptureMessage({
                    record: prepared,
                    requiredFields,
                    missingFields,
                }),
            };
        }

        return this.prepareCreateForConfirmation(prepared, execContext, sessionMemory);
    }

    /**
     * UPDATE flow: find record → show current → capture changes → validate → confirm
     */
    async updateFlow(operation, execContext, sessionMemory) {
        const providedPrimaryKey = operation?.filter?.[this.primaryKey] ?? operation?.data?.[this.primaryKey];
        const hasProvidedPrimaryKey = this.hasValue(providedPrimaryKey);
        const normalizedFilter = {
            ...(operation.filter || {}),
            ...(hasProvidedPrimaryKey ? { [this.primaryKey]: String(providedPrimaryKey).trim() } : {}),
        };

        const existing = await execContext.selectRecords(normalizedFilter);
        if (!existing || existing.length === 0) {
            return {
                success: false,
                operation: 'UPDATE',
                message: `No ${this.entityName} found matching your criteria.`,
            };
        }

        const baselineRecord = existing.length === 1 ? existing[0] : null;
        const { changes, blockedFields } = this.sanitizeUpdateChanges(operation.data || {}, {
            currentRecord: baselineRecord,
        });
        if (this.requiresPrimaryKeyForCriticalOperation(CRUD_OPERATIONS.UPDATE) && !hasProvidedPrimaryKey) {
            if (sessionMemory) {
                sessionMemory.set(pendingKey(this.entityName, PENDING_STATE_SUFFIXES.UPDATE_TARGET_CAPTURE), {
                    records: existing,
                    changes,
                    blockedFields,
                    page: 0,
                    pageSize: DEFAULT_SELECTION_PAGE_SIZE,
                });
            }
            return {
                success: true,
                operation: 'UPDATE',
                requiresInput: true,
                message: this.buildPrimaryKeyPrompt('update', existing, false, 0, DEFAULT_SELECTION_PAGE_SIZE),
            };
        }

        const targetRecord = existing[0];
        return this.prepareUpdateForRecord(
            targetRecord,
            changes,
            execContext,
            sessionMemory,
            { blockedFields },
        );
    }

    /**
     * SELECT flow: query + present
     */
    async selectFlow(operation, execContext, sessionMemory) {
        const selectPaginationKey = pendingKey(this.entityName, PENDING_STATE_SUFFIXES.SELECT_PAGINATION);
        const records = await execContext.selectRecords(operation.filter || {});

        if (!records || records.length === 0) {
            if (sessionMemory) {
                sessionMemory.delete(selectPaginationKey);
            }
            return {
                success: true,
                operation: 'SELECT',
                records: [],
                count: 0,
                message: `No ${this.entityName} records found.`,
            };
        }

        // Present each record
        const presented = await Promise.all(
            records.map(record =>
                execContext.presentRecord
                    ? execContext.presentRecord(record)
                    : record
            ),
        );

        const safePresented = sanitizeRecordsForUser(presented);
        if (sessionMemory) {
            sessionMemory.delete(selectPaginationKey);
        }
        return this.buildSelectAllResult(safePresented);
    }

    /**
     * DELETE flow: find records → show → ask confirmation
     */
    async deleteFlow(operation, execContext, sessionMemory) {
        const providedPrimaryKey = operation?.filter?.[this.primaryKey] ?? operation?.data?.[this.primaryKey];
        const hasProvidedPrimaryKey = this.hasValue(providedPrimaryKey);

        const normalizedFilter = {
            ...(operation.filter || {}),
            ...(hasProvidedPrimaryKey ? { [this.primaryKey]: String(providedPrimaryKey).trim() } : {}),
        };

        const records = await execContext.selectRecords(normalizedFilter);

        if (!records || records.length === 0) {
            return {
                success: false,
                operation: 'DELETE',
                message: `No ${this.entityName} found matching your criteria.`,
            };
        }

        if (this.requiresPrimaryKeyForCriticalOperation(CRUD_OPERATIONS.DELETE) && !hasProvidedPrimaryKey) {
            if (sessionMemory) {
                sessionMemory.set(pendingKey(this.entityName, PENDING_STATE_SUFFIXES.DELETE_CAPTURE), {
                    records,
                    page: 0,
                    pageSize: DEFAULT_SELECTION_PAGE_SIZE,
                });
            }
            return {
                success: true,
                operation: 'DELETE',
                requiresInput: true,
                message: this.buildPrimaryKeyPrompt('delete', records, false, 0, DEFAULT_SELECTION_PAGE_SIZE),
            };
        }

        // Show what will be deleted
        const presented = await Promise.all(
            records.map(record =>
                execContext.presentRecord
                    ? execContext.presentRecord(record)
                    : record
            ),
        );

        const safePresented = sanitizeRecordsForUser(presented);
        const table = formatRecordsTable(safePresented, this.fields, this.entityName);

        if (sessionMemory) {
            sessionMemory.set(pendingKey(this.entityName, PENDING_STATE_SUFFIXES.DELETE), {
                records,
            });
        }

        return {
            success: true,
            operation: 'DELETE',
            requiresConfirmation: true,
            message: `About to delete ${records.length} ${this.entityName} record(s):\n\n${table}\n\nReply **yes** to confirm or **no** to cancel.`,
        };
    }
}
