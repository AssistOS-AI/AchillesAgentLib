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
    sanitizeRecordsForUser,
} from '../helpers/conversationDisplayUtils.mjs';

const SELECT_PREFIX_RE = /^\s*(list|show|display|view|get|find|search)\b/i;
const MUTATION_PREFIX_RE = /^\s*(add|create|new|insert|update|edit|change|delete|remove|drop)\b/i;
const PK_SHORTCUT_RE = /^\s*(update|edit|change|delete|remove|drop)\s+([a-zA-Z_][\w-]*)\s+([^\s,]+)\s*$/i;

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

export async function parseOperation(controller, prompt) {
    const fieldInfo = formatFieldInfo(controller.fields);
    const operationPrompt = buildParseOperationPrompt(
        prompt,
        controller.entityName,
        controller.parsedSkill.tablePurpose,
        fieldInfo,
        controller.parsedSkill.instructions || '',
    );

    const parsed = await controller.llmAgent.executePrompt(operationPrompt, {
        mode: 'fast',
        responseShape: 'json',
    });

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

    return normalizedParsed;
}

export async function selectFlow(controller, operation, execContext, sessionMemory) {
    const selectPaginationKey = pendingKey(controller.entityName, PENDING_STATE_SUFFIXES.SELECT_PAGINATION);
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
            message: `No ${controller.entityName} records found.`,
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
    return controller.buildSelectAllResult(safePresented);
}
