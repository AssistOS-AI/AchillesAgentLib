import { isNoResponse } from '../../utils/ConfirmationUtils.mjs';
import {
    PENDING_STATE_SUFFIXES,
    pendingKey,
    DEFAULT_SELECTION_PAGE_SIZE,
} from '../constants.mjs';
import {
    buildParseOperationPrompt,
    formatFieldInfo,
} from '../templates/prompts.mjs';
import {
    paginateRecords,
    formatRecordsTable,
    sanitizeRecordsForUser,
} from '../helpers/conversationDisplayUtils.mjs';

const SELECT_PREFIX_RE = /^\s*(list|show|display|view|get|find|search)\b/i;
const MUTATION_PREFIX_RE = /^\s*(add|create|new|insert|update|edit|change|delete|remove|drop)\b/i;
const PK_SHORTCUT_RE = /^\s*(update|edit|change|delete|remove|drop)\s+([a-zA-Z_][\w-]*)\s+([^\s,]+)\s*$/i;
const SELECT_FIRST_RE = /\b(?:first|top)\s+(\d+)\b/i;
const SELECT_LAST_RE = /\blast\s+(\d+)\b/i;
const SELECT_LIMIT_RE = /\blimit\s+(\d+)\b/i;
const SELECT_MAX_WINDOW_LIMIT = 1000;

function looksLikeSelectCommand(prompt) {
    const text = String(prompt || '').trim().toLowerCase();
    if (!text) return false;
    if (!SELECT_PREFIX_RE.test(text)) return false;
    if (MUTATION_PREFIX_RE.test(text)) return false;
    return true;
}

function extractPrimaryKeyShortcut(prompt, entityName) {
    const text = String(prompt || '').trim();
    const targetEntity = String(entityName || '').trim().toLowerCase();
    if (!text || !targetEntity) return null;

    const match = text.match(PK_SHORTCUT_RE);
    if (!match) return null;

    const mentionedEntity = String(match[2] || '').trim().toLowerCase();
    const entityMatches = mentionedEntity === targetEntity || mentionedEntity === `${targetEntity}s`;
    if (!entityMatches) return null;

    return String(match[3] || '').trim() || null;
}

function normalizePositiveLimit(value) {
    const parsed = Number.parseInt(String(value || '').trim(), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return Math.min(parsed, SELECT_MAX_WINDOW_LIMIT);
}

function stripWrappingQuotes(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    const unwrapped = text
        .replace(/^["'`“”]+/, '')
        .replace(/["'`“”]+$/, '')
        .replace(/[.,;!?]+$/, '')
        .trim();
    return unwrapped;
}

function resolveFieldNameFromPhrase(controller, phrase) {
    const normalizedPhrase = controller.normalizeMatchText(phrase);
    if (!normalizedPhrase) return null;

    const fields = Object.keys(controller.fields || {});
    let bestField = null;
    let bestScore = 0;

    for (const fieldName of fields) {
        const candidates = controller.getNormalizedFieldCandidates(fieldName);
        for (const candidate of candidates) {
            if (!candidate) continue;
            if (candidate === normalizedPhrase) return fieldName;
            if (normalizedPhrase.includes(candidate) || candidate.includes(normalizedPhrase)) {
                const score = Math.min(candidate.length, normalizedPhrase.length);
                if (score > bestScore) {
                    bestScore = score;
                    bestField = fieldName;
                }
            }
        }
    }

    return bestField;
}

function parseSelectConditionFromPrompt(controller, prompt) {
    const text = String(prompt || '').trim();
    if (!text) return null;

    let match = text.match(/\b(?:with|where)\s+([a-zA-Z_][\w\s-]{0,40}?)\s+(contains|is|=)\s+(.+)$/i);
    let operator = 'equals';
    let fieldPhrase = '';
    let valuePhrase = '';

    if (match) {
        fieldPhrase = String(match[1] || '').trim();
        operator = String(match[2] || '').trim().toLowerCase() === 'contains' ? 'contains' : 'equals';
        valuePhrase = String(match[3] || '').trim();
    } else {
        match = text.match(/\b(?:with|where)\s+([a-zA-Z_][\w\s-]{0,40}?)\s+(.+)$/i);
        if (!match) return null;
        fieldPhrase = String(match[1] || '').trim();
        valuePhrase = String(match[2] || '').trim();
    }

    const fieldName = resolveFieldNameFromPhrase(controller, fieldPhrase);
    const value = stripWrappingQuotes(valuePhrase);
    if (!fieldName || !value) return null;

    return {
        field: fieldName,
        operator,
        value,
    };
}

function parseSelectWindowDirective(prompt, operation = {}) {
    const query = operation && typeof operation.query === 'object' && operation.query !== null
        ? operation.query
        : {};
    const queryWindowRaw = String(query.window || query.slice || query.position || '').trim().toLowerCase();
    const queryLimitRaw = query.limit ?? query.count ?? query.take ?? query.first ?? query.last;
    const queryLimit = normalizePositiveLimit(queryLimitRaw);

    if (queryLimit && (queryWindowRaw === 'first' || queryWindowRaw === 'last')) {
        return { window: queryWindowRaw, limit: queryLimit };
    }
    if (queryLimit && !queryWindowRaw) {
        return { window: 'first', limit: queryLimit };
    }

    const text = String(prompt || '');
    if (!text) return null;

    const lastMatch = text.match(SELECT_LAST_RE);
    if (lastMatch) {
        const limit = normalizePositiveLimit(lastMatch[1]);
        return limit ? { window: 'last', limit } : null;
    }

    const firstMatch = text.match(SELECT_FIRST_RE) || text.match(SELECT_LIMIT_RE);
    if (firstMatch) {
        const limit = normalizePositiveLimit(firstMatch[1]);
        return limit ? { window: 'first', limit } : null;
    }

    return null;
}

function normalizePostFilters(postFilters = []) {
    if (!Array.isArray(postFilters)) return [];
    return postFilters
        .map(entry => ({
            field: String(entry?.field || '').trim(),
            operator: String(entry?.operator || 'equals').trim().toLowerCase(),
            value: stripWrappingQuotes(entry?.value),
        }))
        .filter(entry => entry.field && entry.value);
}

function applyPostFilters(records, postFilters = []) {
    if (!Array.isArray(records) || records.length === 0) return [];
    const normalized = normalizePostFilters(postFilters);
    if (normalized.length === 0) return records;

    return records.filter(record =>
        normalized.every(filter => {
            const actualValue = record?.[filter.field];
            const actual = String(actualValue ?? '').trim().toLowerCase();
            const expected = String(filter.value || '').trim().toLowerCase();
            if (filter.operator === 'contains') {
                return actual.includes(expected);
            }
            return actual === expected;
        })
    );
}

export async function handleSelectPagination(controller, prompt, pending, sessionMemory, key) {
    const text = String(prompt || '').trim();
    if (!text) {
        return controller.buildSelectPageResult(
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

    const paginationCommand = controller.parseSelectPaginationCommand(prompt);
    if (!paginationCommand) {
        // Non-navigation input should continue as a fresh request.
        sessionMemory.delete(key);
        return null;
    }

    if (paginationCommand === 'all') {
        sessionMemory.delete(key);
        return controller.buildSelectAllResult(pending.records || []);
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

    return controller.buildSelectPageResult(
        pending.records || [],
        pending.page,
        pending.pageSize,
        boundaryMessage,
    );
}

/**
 * Check all pending states and handle the user's response.
 * Returns a result if a pending state was found, null otherwise.
 */
export async function handlePendingState(controller, prompt, sessionMemory) {
    // Create confirmation
    const createKey = pendingKey(controller.entityName, PENDING_STATE_SUFFIXES.CREATE);
    const pendingCreate = sessionMemory.get(createKey);
    if (pendingCreate) {
        return controller.handleCreateConfirmation(prompt, pendingCreate, sessionMemory, createKey);
    }

    // Create collision resolution (create -> update fallback)
    const createConflictKey = pendingKey(controller.entityName, PENDING_STATE_SUFFIXES.CREATE_CONFLICT_UPDATE);
    const pendingCreateConflict = sessionMemory.get(createConflictKey);
    if (pendingCreateConflict) {
        return controller.handleCreateConflictUpdateConfirmation(prompt, pendingCreateConflict, sessionMemory, createConflictKey);
    }

    // Create required-field capture
    const createCaptureKey = pendingKey(controller.entityName, PENDING_STATE_SUFFIXES.CREATE_CAPTURE);
    const pendingCreateCapture = sessionMemory.get(createCaptureKey);
    if (pendingCreateCapture) {
        return controller.handleCreateFieldCapture(prompt, pendingCreateCapture, sessionMemory, createCaptureKey);
    }

    // Update confirmation
    const updateKey = pendingKey(controller.entityName, PENDING_STATE_SUFFIXES.UPDATE);
    const pendingUpdate = sessionMemory.get(updateKey);
    if (pendingUpdate) {
        return controller.handleUpdateConfirmation(prompt, pendingUpdate, sessionMemory, updateKey);
    }

    // Update target capture (user must provide primary key to update)
    const updateTargetCaptureKey = pendingKey(controller.entityName, PENDING_STATE_SUFFIXES.UPDATE_TARGET_CAPTURE);
    const pendingUpdateTargetCapture = sessionMemory.get(updateTargetCaptureKey);
    if (pendingUpdateTargetCapture) {
        return controller.handleUpdateTargetCapture(prompt, pendingUpdateTargetCapture, sessionMemory, updateTargetCaptureKey);
    }

    // Update field capture (user is specifying what to change)
    const captureKey = pendingKey(controller.entityName, PENDING_STATE_SUFFIXES.UPDATE_CAPTURE);
    const pendingCapture = sessionMemory.get(captureKey);
    if (pendingCapture) {
        return controller.handleUpdateFieldCapture(prompt, pendingCapture, sessionMemory, captureKey);
    }

    // Delete id capture (user must provide primary key to delete)
    const deleteCaptureKey = pendingKey(controller.entityName, PENDING_STATE_SUFFIXES.DELETE_CAPTURE);
    const pendingDeleteCapture = sessionMemory.get(deleteCaptureKey);
    if (pendingDeleteCapture) {
        return controller.handleDeleteIdCapture(prompt, pendingDeleteCapture, sessionMemory, deleteCaptureKey);
    }

    // Delete confirmation
    const deleteKey = pendingKey(controller.entityName, PENDING_STATE_SUFFIXES.DELETE);
    const pendingDelete = sessionMemory.get(deleteKey);
    if (pendingDelete) {
        return controller.handleDeleteConfirmation(prompt, pendingDelete, sessionMemory, deleteKey);
    }

    // Validation corrections
    const validationKey = pendingKey(controller.entityName, PENDING_STATE_SUFFIXES.VALIDATION);
    const pendingValidation = sessionMemory.get(validationKey);
    if (pendingValidation) {
        return controller.handleValidationCorrections(prompt, pendingValidation, sessionMemory, validationKey);
    }

    // Select pagination (next/prev navigation over large SELECT results)
    const selectPaginationKey = pendingKey(controller.entityName, PENDING_STATE_SUFFIXES.SELECT_PAGINATION);
    const pendingSelectPagination = sessionMemory.get(selectPaginationKey);
    if (pendingSelectPagination) {
        sessionMemory.delete(selectPaginationKey);
    }

    return null;
}

/**
 * Fallback operation parsing when LLM is unavailable.
 * Uses simple pattern matching to determine operation type.
 */
function fallbackOperationParsing(prompt, controller, sessionMemory) {
    const lowerPrompt = prompt.toLowerCase().trim();
    
    // First check if there's an ongoing session that should be continued
    if (sessionMemory) {
        // Check for ongoing UPDATE session
        const updateKey = pendingKey(controller.entityName, PENDING_STATE_SUFFIXES.UPDATE);
        const pendingUpdate = sessionMemory.get(updateKey);
        if (pendingUpdate) {
            return {
                operation: 'UPDATE',
                filter: { [controller.primaryKey]: pendingUpdate.id }
            };
        }
        
        // Check for ongoing CREATE session
        const createKey = pendingKey(controller.entityName, PENDING_STATE_SUFFIXES.CREATE);
        const pendingCreate = sessionMemory.get(createKey);
        if (pendingCreate) {
            return { operation: 'CREATE' };
        }
        
        // Check for ongoing DELETE session
        const deleteKey = pendingKey(controller.entityName, PENDING_STATE_SUFFIXES.DELETE);
        const pendingDelete = sessionMemory.get(deleteKey);
        if (pendingDelete) {
            return { operation: 'DELETE' };
        }
    }
    
    // No ongoing session - use keyword matching
    if (lowerPrompt.includes('create') || lowerPrompt.includes('add') || lowerPrompt.includes('new')) {
        return { operation: 'CREATE' };
    }
    
    if (lowerPrompt.includes('delete') || lowerPrompt.includes('remove')) {
        return { operation: 'DELETE' };
    }
    
    if (lowerPrompt.includes('change') || lowerPrompt.includes('update') || lowerPrompt.includes('modify')) {
        // For change/update operations, try to extract the ID
        let idMatch = lowerPrompt.match(/(?:change|update|modify)\s+(\w+)\s+([a-zA-Z0-9]+)/);
        
        // If no match, try just finding an ID in the prompt
        if (!idMatch) {
            idMatch = lowerPrompt.match(/([a-zA-Z][a-zA-Z0-9]+)/);
        }
        
        if (idMatch) {
            return {
                operation: 'UPDATE',
                filter: { [controller.primaryKey]: idMatch[2] || idMatch[1] }
            };
        }
        
        return { operation: 'UPDATE' };
    }
    
    // Default to SELECT for listing queries
    return { operation: 'SELECT' };
}

export async function parseOperation(controller, prompt) {
    const fieldInfo = formatFieldInfo(controller.fields);
    const operationPrompt = buildParseOperationPrompt(
        prompt,
        controller.entityName,
        controller.parsedSkill.tablePurpose,
        fieldInfo,
        controller.parsedSkill.instructions || '',
    );

    let parsed;
    try {
        parsed = await controller.llmAgent.executePrompt(operationPrompt, {
            mode: 'fast',
            responseShape: 'json',
        });
    } catch (error) {
        // LLM failed - use fallback heuristics
        console.warn(`LLM operation parsing failed: ${controller.extractErrorMessage(error)}`);
        parsed = fallbackOperationParsing(prompt, controller, controller.sessionMemory);
    }

    let normalizedParsed = parsed && typeof parsed === 'object' ? { ...parsed } : {};
    const parsedOperation = String(normalizedParsed?.operation || '').toUpperCase();

    // Guard against LLM misclassifying explicit listing intents as CREATE/UPDATE.
    if (looksLikeSelectCommand(prompt) && parsedOperation !== 'SELECT') {
        const safeFilter = parsed && typeof parsed.filter === 'object' && parsed.filter !== null
            ? parsed.filter
            : {};
        normalizedParsed = {
            ...normalizedParsed,
            operation: 'SELECT',
            filter: safeFilter,
        };
    }

    // Guard against LLM mapping shorthand "change <entity> <id>" to non-PK filters.
    const pkShortcut = extractPrimaryKeyShortcut(prompt, controller.entityName);
    const normalizedOperation = String(normalizedParsed?.operation || '').toUpperCase();
    if (pkShortcut && (normalizedOperation === 'UPDATE' || normalizedOperation === 'DELETE')) {
        const currentFilter = normalizedParsed && typeof normalizedParsed.filter === 'object' && normalizedParsed.filter !== null
            ? normalizedParsed.filter
            : {};
        const hasPrimaryKey = Object.prototype.hasOwnProperty.call(currentFilter, controller.primaryKey)
            && String(currentFilter[controller.primaryKey] || '').trim() !== '';
        if (!hasPrimaryKey) {
            normalizedParsed = {
                ...normalizedParsed,
                filter: {
                    [controller.primaryKey]: pkShortcut,
                },
            };
        }
    }

    const finalizedOperation = String(normalizedParsed?.operation || '').toUpperCase();
    if (finalizedOperation === 'SELECT') {
        const currentFilter = normalizedParsed && typeof normalizedParsed.filter === 'object' && normalizedParsed.filter !== null
            ? { ...normalizedParsed.filter }
            : {};
        const hasFilter = Object.keys(currentFilter).length > 0;

        const selectCondition = parseSelectConditionFromPrompt(controller, prompt);
        const existingPostFilters = normalizePostFilters(normalizedParsed?.postFilters);

        const mergedPostFilters = [...existingPostFilters];
        if (!hasFilter && selectCondition) {
            mergedPostFilters.push(selectCondition);
        }

        const selectWindow = parseSelectWindowDirective(prompt, normalizedParsed);
        if (selectWindow) {
            normalizedParsed = {
                ...normalizedParsed,
                query: {
                    ...(normalizedParsed?.query && typeof normalizedParsed.query === 'object' ? normalizedParsed.query : {}),
                    window: selectWindow.window,
                    limit: selectWindow.limit,
                },
            };
        }

        if (mergedPostFilters.length > 0) {
            normalizedParsed = {
                ...normalizedParsed,
                postFilters: mergedPostFilters,
            };
        }
    }

    return normalizedParsed;
}

export async function selectFlow(controller, operation, execContext, sessionMemory, prompt = '') {
    const selectPaginationKey = pendingKey(controller.entityName, PENDING_STATE_SUFFIXES.SELECT_PAGINATION);
    const baseFilter = operation && typeof operation.filter === 'object' && operation.filter !== null
        ? operation.filter
        : {};
    let records = await execContext.selectRecords(baseFilter);
    let filteredRecords = Array.isArray(records) ? records : [];

    const postFilters = normalizePostFilters(operation?.postFilters);
    if (postFilters.length > 0) {
        if (filteredRecords.length === 0 && Object.keys(baseFilter).length > 0) {
            const fallbackRecords = await execContext.selectRecords({});
            filteredRecords = Array.isArray(fallbackRecords) ? fallbackRecords : [];
        }
        filteredRecords = applyPostFilters(filteredRecords, postFilters);
    }

    if (!filteredRecords || filteredRecords.length === 0) {
        if (sessionMemory) {
            sessionMemory.delete(selectPaginationKey);
        }
        return {
            success: true,
            operation: 'SELECT',
            records: [],
            count: 0,
            message: `No ${controller.entityName} records found.`,
        };
    }

    // Present each record
    const presented = await Promise.all(
        filteredRecords.map(record =>
            execContext.presentRecord
                ? execContext.presentRecord(record)
                : record
        ),
    );

    const safePresented = sanitizeRecordsForUser(presented);
    const selectWindow = parseSelectWindowDirective(prompt, operation);
    if (sessionMemory) {
        sessionMemory.delete(selectPaginationKey);
    }

    if (selectWindow) {
        const totalCount = safePresented.length;
        const limited = selectWindow.window === 'last'
            ? safePresented.slice(Math.max(totalCount - selectWindow.limit, 0))
            : safePresented.slice(0, selectWindow.limit);

        const table = formatRecordsTable(limited, controller.getListTableFields(), controller.entityName, {
            resolveLabel: (fieldName) => controller.getFieldLabel(fieldName, 'short'),
        });

        return {
            success: true,
            operation: 'SELECT',
            records: limited,
            count: limited.length,
            totalCount,
            requiresInput: false,
            renderRecordsTable: false,
            message: `Found ${totalCount} ${controller.entityName}(s):\n\n${table}\n\nShowing ${selectWindow.window} ${limited.length} ${controller.entityName}(s).`,
        };
    }

    return controller.buildSelectAllResult(safePresented);
}
