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

import { IOServices } from '../services/IOServices.mjs';
import {
    CRUD_OPERATIONS,
    PENDING_STATE_SUFFIXES,
    pendingKey,
    NULL_DISPLAY_VALUE,
    DEFAULT_SELECTION_PAGE_SIZE,
} from './constants.mjs';
import {
    formatRecordTable,
    formatRecordsTable,
    escapeRegex,
    stripExampleHints,
    humanizeFieldName,
    sanitizeRecordForUser,
    sanitizeRecordsForUser,
    paginateRecords,
} from './helpers/conversationDisplayUtils.mjs';
import {
    extractCreateDataFromInput as extractCreateDataFromInputFlow,
    prepareCreateForConfirmation as prepareCreateForConfirmationFlow,
    handleCreateFieldCapture as handleCreateFieldCaptureFlow,
    handleCreateConfirmation as handleCreateConfirmationFlow,
    handleCreateConflictUpdateConfirmation as handleCreateConflictUpdateConfirmationFlow,
    createFlow as createFlowHandler,
} from './flows/createFlowHandlers.mjs';
import {
    handleUpdateConfirmation as handleUpdateConfirmationFlow,
    prepareUpdateForRecord as prepareUpdateForRecordFlow,
    handleUpdateTargetCapture as handleUpdateTargetCaptureFlow,
    handleUpdateFieldCapture as handleUpdateFieldCaptureFlow,
    updateFlow as updateFlowHandler,
} from './flows/updateFlowHandlers.mjs';
import {
    handleDeleteIdCapture as handleDeleteIdCaptureFlow,
    handleDeleteConfirmation as handleDeleteConfirmationFlow,
    deleteFlow as deleteFlowHandler,
} from './flows/deleteFlowHandlers.mjs';
import { handleValidationCorrections as handleValidationCorrectionsFlow } from './flows/validationFlowHandlers.mjs';
import {
    handleSelectPagination as handleSelectPaginationFlow,
    handlePendingState as handlePendingStateFlow,
    parseOperation as parseOperationFlow,
    selectFlow as selectFlowHandler,
} from './flows/routingFlowHandlers.mjs';


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
        if (typeof left === 'string' || typeof right === 'string') {
            return this.normalizeTextForComparison(left) === this.normalizeTextForComparison(right);
        }
        return String(left).trim() === String(right).trim();
    }

    normalizeTextForComparison(value) {
        if (!this.hasValue(value)) return '';
        return String(value)
            .normalize('NFKC')
            .trim()
            .replace(/\s+/g, ' ')
            .toLowerCase();
    }

    normalizeValueForStorage(value) {
        if (typeof value !== 'string') return value;
        const normalized = value
            .normalize('NFKC')
            .trim()
            .replace(/\s+/g, ' ');
        return normalized === '' ? null : normalized;
    }

    normalizePrimaryKeyForComparison(value) {
        if (!this.hasValue(value)) return '';
        const text = String(value).trim();
        if (String(this.entityName || '').toLowerCase() === 'equipment') {
            return text.toUpperCase().replace(/-/g, '');
        }
        return text.toLowerCase();
    }

    async findCreateCollisionRecord(record, execContext) {
        if (String(this.entityName || '').toLowerCase() !== 'equipment') return null;
        const candidatePk = record?.[this.primaryKey];
        if (!this.hasValue(candidatePk)) return null;
        if (!execContext || typeof execContext.selectRecords !== 'function') return null;

        const records = await execContext.selectRecords({});
        const normalizedCandidate = this.normalizePrimaryKeyForComparison(candidatePk);
        if (!normalizedCandidate) return null;

        for (const existing of records || []) {
            const existingPk = existing?.[this.primaryKey];
            if (!this.hasValue(existingPk)) continue;
            if (this.normalizePrimaryKeyForComparison(existingPk) === normalizedCandidate) {
                return existing;
            }
        }
        return null;
    }

    buildCreateConflictUpdateMessage(newRecord, existingRecord) {
        const incomingPk = this.formatDisplayValue(newRecord?.[this.primaryKey]);
        const existingPk = this.formatDisplayValue(existingRecord?.[this.primaryKey]);
        const pkLabel = this.getFieldShortLabel(this.primaryKey);

        return `A ${this.entityName} with ${pkLabel} **${existingPk}** already exists.\n\nYour value **${incomingPk}** matches the same identifier (comparison ignores "-").\n\nDo you want to update the existing record with the values you provided? Reply **yes** to update or **no** to cancel.`;
    }

    getFieldFullLabel(fieldName) {
        const fieldDef = this.fields?.[fieldName];
        return String(fieldDef?.description || humanizeFieldName(fieldName) || fieldName);
    }

    getFieldShortLabel(fieldName) {
        const fieldDef = this.fields?.[fieldName] || {};
        const explicitShort = fieldDef.shortLabel
            || fieldDef.short_label
            || fieldDef.label
            || null;
        if (explicitShort && String(explicitShort).trim()) {
            return stripExampleHints(explicitShort) || String(explicitShort).trim();
        }

        // Keep "Field" concise and predictable across all tables.
        return String(fieldName || '').trim();
    }

    getFieldLabel(fieldName, mode = 'short') {
        return mode === 'full'
            ? this.getFieldFullLabel(fieldName)
            : this.getFieldShortLabel(fieldName);
    }

    isFieldMandatory(fieldName) {
        return Boolean(this.fields?.[fieldName]?.isRequired);
    }

    getFieldGuidance(fieldName) {
        const description = this.getFieldFullLabel(fieldName);
        if (this.isFieldMandatory(fieldName)) {
            return `**Required**: ${description}`;
        }
        return `Optional: ${description}`;
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

    getOperationVerb(operation = '') {
        const normalized = String(operation || '').trim().toUpperCase();
        switch (normalized) {
            case CRUD_OPERATIONS.CREATE:
                return 'create';
            case CRUD_OPERATIONS.UPDATE:
                return 'update';
            case CRUD_OPERATIONS.DELETE:
                return 'delete';
            case CRUD_OPERATIONS.SELECT:
                return 'retrieve';
            default:
                return 'complete';
        }
    }

    extractErrorMessage(error) {
        if (error === null || error === undefined) return '';
        if (typeof error === 'string') return error;
        if (typeof error?.message === 'string') return error.message;
        try {
            return JSON.stringify(error);
        } catch {
            return String(error);
        }
    }

    isDependencyErrorMessage(message) {
        return /(foreign key|constraint|referenc|dependent|violat)/i.test(String(message || ''));
    }

    isDuplicateErrorMessage(message) {
        return /(already exists|duplicate|unique constraint|must be unique|uniqueness|duplicate key|conflict)/i.test(String(message || ''));
    }

    isServiceUnavailableMessage(message) {
        return /(dbadapter not available|database service is not available|service unavailable|cannot access database|failed to read .* records|failed to query)/i.test(String(message || ''));
    }

    isTimeoutMessage(message) {
        return /(timed out|timeout)/i.test(String(message || ''));
    }

    buildCrudFailureMessage(operation, error) {
        const verb = this.getOperationVerb(operation);
        const entity = String(this.entityName || 'record');

        let details = this.extractErrorMessage(error);
        details = this.sanitizeErrorTextForUser(details, 'short');
        details = String(details || '')
            .replace(/^error:\s*/i, '')
            .replace(/\s+/g, ' ')
            .trim();

        if (!details) {
            return `Cannot ${verb} ${entity} right now due to an unexpected error.`;
        }

        if (/^(cannot|failed to|unable to)\b/i.test(details)) {
            return details;
        }

        if (this.isTimeoutMessage(details)) {
            return `Cannot ${verb} ${entity} right now because the request timed out. Please try again.`;
        }

        if (this.isServiceUnavailableMessage(details)) {
            return `Cannot ${verb} ${entity} right now because the database service is unavailable. Details: ${details}`;
        }

        if (this.isDuplicateErrorMessage(details)) {
            return `Cannot ${verb} ${entity} because a record with the same unique value already exists. Details: ${details}`;
        }

        if (this.isDependencyErrorMessage(details)) {
            return `Cannot ${verb} ${entity} because related records depend on it. Details: ${details}`;
        }

        return `Cannot ${verb} ${entity}. Details: ${details}`;
    }

    buildCrudFailureResult(operation, error) {
        return {
            success: false,
            operation: String(operation || 'UNKNOWN').toUpperCase(),
            message: this.buildCrudFailureMessage(operation, error),
        };
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
        const required = Object.entries(this.fields || {})
            .filter(([, fieldDef]) => Boolean(fieldDef?.isRequired))
            .map(([fieldName]) => fieldName);
        const captureFields = this.getCreateCaptureFields();
        return required.filter(fieldName => captureFields.includes(fieldName));
    }

    getCreateCaptureFields() {
        const configured = Array.isArray(this.parsedSkill?.interactiveFields)
            ? this.parsedSkill.interactiveFields
            : [];
        const validConfigured = configured.filter(fieldName =>
            Object.prototype.hasOwnProperty.call(this.fields || {}, fieldName),
        );
        return Array.from(new Set(validConfigured));
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
                filtered[key] = this.normalizeValueForStorage(value);
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

    getListTableFields(options = {}) {
        const includePrimaryKey = Boolean(options?.includePrimaryKey);
        const interactiveFields = Array.isArray(this.parsedSkill?.interactiveFields)
            ? this.parsedSkill.interactiveFields
            : [];
        const listExtraFields = Array.isArray(this.parsedSkill?.listExtraFields)
            ? this.parsedSkill.listExtraFields
            : [];
        const orderedFields = [
            ...listExtraFields,
            ...interactiveFields,
        ];

        if (
            includePrimaryKey
            && this.hasValue(this.primaryKey)
            && !orderedFields.includes(this.primaryKey)
        ) {
            orderedFields.unshift(this.primaryKey);
        }

        const uniqueFields = [];
        const seen = new Set();
        for (const rawField of orderedFields) {
            const fieldName = String(rawField || '').trim();
            if (!fieldName || seen.has(fieldName)) continue;
            seen.add(fieldName);
            uniqueFields.push(fieldName);
        }

        const tableFields = {};
        for (const fieldName of uniqueFields) {
            tableFields[fieldName] = this.fields?.[fieldName] || { name: fieldName };
        }

        return tableFields;
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

    buildUpdateClarificationMessage(prompt, immutableNotice = '', currentRecord = null) {
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

        return `${immutableSection}I could not determine which fields to update.\n\n${this.buildUpdateCaptureInstructions('', currentRecord)}`;
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
        rows.push('| Field | Description | Status | Value |');
        rows.push('|-------|-------------|--------|-------|');

        for (const fieldName of requiredFields || []) {
            const shortLabel = this.getFieldShortLabel(fieldName);
            const guidance = this.getFieldGuidance(fieldName);
            const value = record?.[fieldName];
            const hasValue = this.hasValue(value);
            const status = hasValue
                ? 'Completed'
                : (this.isFieldMandatory(fieldName) ? 'Missing' : 'Optional');
            const displayValue = this.formatDisplayValue(value);
            rows.push(`| ${shortLabel} | ${guidance} | ${status} | ${displayValue} |`);
        }

        return rows.join('\n');
    }

    buildCreateCaptureMessage(pending, intro = '') {
        const requiredFields = pending?.requiredFields || [];
        const captureFields = this.getCreateCaptureFields();
        const record = pending?.record || {};
        const missingFields = this.getMissingRequiredFields(record, requiredFields);
        const requiredTable = this.formatCreateRequiredFieldsTable(captureFields, record);
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

        return `${introSection}To create this ${this.entityName}, provide values for all required fields.\n\n${requiredTable}\n\n${missingText}\n\nYou can provide one or more fields in a single message. Example: "${exampleText}".\nType **cancel** to abort.`;
    }

    clearCreatePendingStates(sessionMemory) {
        if (!sessionMemory) return;
        const createKey = pendingKey(this.entityName, PENDING_STATE_SUFFIXES.CREATE);
        const createConflictKey = pendingKey(this.entityName, PENDING_STATE_SUFFIXES.CREATE_CONFLICT_UPDATE);
        const createCaptureKey = pendingKey(this.entityName, PENDING_STATE_SUFFIXES.CREATE_CAPTURE);
        const validationKey = pendingKey(this.entityName, PENDING_STATE_SUFFIXES.VALIDATION);

        sessionMemory.delete(createKey);
        sessionMemory.delete(createConflictKey);
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

    buildEditableUpdateFieldsTable(currentRecord = null) {
        const mutableFields = this.getMutableUpdateFields();
        const fieldNames = Object.keys(mutableFields || {});
        if (fieldNames.length === 0) {
            return 'No editable fields are available.';
        }

        const rows = [];
        const hasCurrentRecord = currentRecord && typeof currentRecord === 'object';
        if (hasCurrentRecord) {
            rows.push('| Field | Current Value | Description |');
            rows.push('|-------|---------------|-------------|');
        } else {
            rows.push('| Editable field | Description |');
            rows.push('|----------------|-------------|');
        }

        for (const fieldName of fieldNames) {
            const shortLabel = this.getFieldShortLabel(fieldName);
            const guidance = this.getFieldGuidance(fieldName);
            if (hasCurrentRecord) {
                const currentValue = this.formatDisplayValue(currentRecord[fieldName]);
                rows.push(`| ${shortLabel} | ${currentValue} | ${guidance} |`);
            } else {
                rows.push(`| ${shortLabel} | ${guidance} |`);
            }
        }

        return rows.join('\n');
    }

    buildUpdateCaptureInstructions(immutableNotice = '', currentRecord = null) {
        const noticeSection = immutableNotice ? `${immutableNotice}\n\n` : '';
        const editableTable = this.buildEditableUpdateFieldsTable(currentRecord);
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
        const table = formatRecordsTable(paging.items, this.getListTableFields({ includePrimaryKey: true }), this.entityName, {
            resolveLabel: (fieldName) => this.getFieldLabel(fieldName, 'short'),
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
        const table = formatRecordsTable(paging.items, this.getListTableFields(), this.entityName, {
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
        const table = formatRecordsTable(allRecords, this.getListTableFields(), this.entityName, {
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
        return handleSelectPaginationFlow(this, prompt, pending, sessionMemory, key);
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
        let parsedOperation = null;

        try {
            // 1. Check for pending state first
            if (sessionMemory) {
                const pendingResult = await this.handlePendingState(prompt, sessionMemory);
                if (pendingResult) return pendingResult;
            }

            // 2. Parse the operation from the user's prompt
            await this.writeProgress(`Analyzing request for ${this.entityName}...`);
            parsedOperation = await this.parseOperation(prompt);

            // 3. Create execution context with DB operations
            const execContext = this.subsystem.createExecutionContext(
                this.functions,
                this.entityName,
            );

            // 4. Route to the appropriate flow
            await this.writeProgress(`Executing ${parsedOperation.operation} operation...`);
            switch (parsedOperation.operation) {
                case CRUD_OPERATIONS.CREATE:
                    return this.createFlow(parsedOperation, execContext, sessionMemory);
                case CRUD_OPERATIONS.UPDATE:
                    return this.updateFlow(parsedOperation, execContext, sessionMemory);
                case CRUD_OPERATIONS.DELETE:
                    return this.deleteFlow(parsedOperation, execContext, sessionMemory);
                case CRUD_OPERATIONS.SELECT:
                    return this.selectFlow(parsedOperation, execContext, sessionMemory, prompt);
                default:
                    return {
                        success: false,
                        operation: parsedOperation.operation || 'UNKNOWN',
                        message: `Unknown operation: ${parsedOperation.operation}`,
                    };
            }
        } catch (error) {
            const operation = parsedOperation?.operation || 'UNKNOWN';
            return this.buildCrudFailureResult(operation, error);
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
        return handlePendingStateFlow(this, prompt, sessionMemory);
    }

    async extractCreateDataFromInput(prompt, pending) {
        return extractCreateDataFromInputFlow(this, prompt, pending);
    }

    async prepareCreateForConfirmation(record, execContext, sessionMemory) {
        return prepareCreateForConfirmationFlow(this, record, execContext, sessionMemory);
    }

    async handleCreateFieldCapture(prompt, pending, sessionMemory, key) {
        return handleCreateFieldCaptureFlow(this, prompt, pending, sessionMemory, key);
    }

    async handleCreateConfirmation(prompt, pending, sessionMemory, key) {
        return handleCreateConfirmationFlow(this, prompt, pending, sessionMemory, key);
    }

    async handleCreateConflictUpdateConfirmation(prompt, pending, sessionMemory, key) {
        return handleCreateConflictUpdateConfirmationFlow(this, prompt, pending, sessionMemory, key);
    }

    async handleUpdateConfirmation(prompt, pending, sessionMemory, key) {
        return handleUpdateConfirmationFlow(this, prompt, pending, sessionMemory, key);
    }

    async prepareUpdateForRecord(record, changes, execContext, sessionMemory, options = {}) {
        return prepareUpdateForRecordFlow(this, record, changes, execContext, sessionMemory, options);
    }

    async handleUpdateTargetCapture(prompt, pending, sessionMemory, key) {
        return handleUpdateTargetCaptureFlow(this, prompt, pending, sessionMemory, key);
    }

    async handleUpdateFieldCapture(prompt, pending, sessionMemory, key) {
        return handleUpdateFieldCaptureFlow(this, prompt, pending, sessionMemory, key);
    }

    async handleDeleteIdCapture(prompt, pending, sessionMemory, key) {
        return handleDeleteIdCaptureFlow(this, prompt, pending, sessionMemory, key);
    }

    async handleDeleteConfirmation(prompt, pending, sessionMemory, key) {
        return handleDeleteConfirmationFlow(this, prompt, pending, sessionMemory, key);
    }

    async handleValidationCorrections(prompt, pending, sessionMemory, key) {
        return handleValidationCorrectionsFlow(this, prompt, pending, sessionMemory, key);
    }

    // =============================================
    // CRUD FLOWS
    // =============================================

    /**
     * Parse the user's prompt to determine the CRUD operation.
     */
    async parseOperation(prompt) {
        return parseOperationFlow(this, prompt);
    }

    /**
     * CREATE flow:
     * - capture required fields if missing
     * - validate final record
     * - ask confirmation before insert
     */
    async createFlow(operation, execContext, sessionMemory) {
        return createFlowHandler(this, operation, execContext, sessionMemory);
    }

    /**
     * UPDATE flow: find record → show current → capture changes → validate → confirm
     */
    async updateFlow(operation, execContext, sessionMemory) {
        return updateFlowHandler(this, operation, execContext, sessionMemory);
    }

    /**
     * SELECT flow: query + present
     */
    async selectFlow(operation, execContext, sessionMemory, prompt = '') {
        return selectFlowHandler(this, operation, execContext, sessionMemory, prompt);
    }

    /**
     * DELETE flow: find records → show → ask confirmation
     */
    async deleteFlow(operation, execContext, sessionMemory) {
        return deleteFlowHandler(this, operation, execContext, sessionMemory);
    }
}
