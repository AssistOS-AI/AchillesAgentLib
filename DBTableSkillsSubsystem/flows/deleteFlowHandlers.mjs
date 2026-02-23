import {
    resolveConfirmation,
    isNoResponse,
} from '../../utils/ConfirmationUtils.mjs';
import {
    CRUD_OPERATIONS,
    PENDING_STATE_SUFFIXES,
    pendingKey,
    DEFAULT_SELECTION_PAGE_SIZE,
} from '../constants.mjs';
import {
    formatRecordsTable,
    paginateRecords,
    sanitizeRecordForUser,
    sanitizeRecordsForUser,
} from '../helpers/conversationDisplayUtils.mjs';

export async function handleDeleteIdCapture(controller, prompt, pending, sessionMemory, key) {
    if (isNoResponse(prompt) || /^cancel$/i.test(String(prompt || '').trim())) {
        sessionMemory.delete(key);
        return {
            success: true,
            operation: 'DELETE',
            message: 'Delete cancelled.',
            cancelled: true,
        };
    }

    const navigation = controller.parseNavigationCommand(prompt);
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
            message: `${boundaryMessage}${controller.buildPrimaryKeyPrompt('delete', pending.records, false, pending.page, pending.pageSize)}`,
        };
    }

    const targetId = controller.extractPrimaryKeyFromPrompt(prompt, pending.records);
    if (!controller.hasValue(targetId)) {
        return {
            success: true,
            operation: 'DELETE',
            requiresInput: true,
            message: controller.buildPrimaryKeyPrompt('delete', pending.records, true, pending.page || 0, pending.pageSize || DEFAULT_SELECTION_PAGE_SIZE),
        };
    }

    const selectedRecord = (pending.records || []).find(record =>
        String(record?.[controller.primaryKey]).toLowerCase() === String(targetId).toLowerCase(),
    );

    if (!selectedRecord) {
        return {
            success: true,
            operation: 'DELETE',
            requiresInput: true,
            message: controller.buildPrimaryKeyPrompt('delete', pending.records, true, pending.page || 0, pending.pageSize || DEFAULT_SELECTION_PAGE_SIZE),
        };
    }

    sessionMemory.delete(key);
    sessionMemory.set(pendingKey(controller.entityName, PENDING_STATE_SUFFIXES.DELETE), {
        records: [selectedRecord],
    });

    const execContext = controller.subsystem.createExecutionContext(
        controller.functions,
        controller.entityName,
    );
    const presented = execContext.presentRecord
        ? await execContext.presentRecord(selectedRecord)
        : selectedRecord;
    const safeRecord = sanitizeRecordForUser(presented);
    const table = formatRecordsTable([safeRecord], controller.getListTableFields({ includePrimaryKey: true }), controller.entityName, {
        resolveLabel: (fieldName) => controller.getFieldLabel(fieldName, 'short'),
    });

    return {
        success: true,
        operation: 'DELETE',
        requiresConfirmation: true,
        message: `About to delete 1 ${controller.entityName} record:\n\n${table}\n\nReply **yes** to confirm or **no** to cancel.`,
    };
}

export async function handleDeleteConfirmation(controller, prompt, pending, sessionMemory, key) {
    const decision = await resolveConfirmation(prompt, controller.llmAgent, {
        actionContext: `confirming deletion of ${controller.entityName}`,
    });

    if (decision === 'yes') {
        sessionMemory.delete(key);
        await controller.writeProgress(`Deleting ${controller.entityName} record(s)...`);
        const execContext = controller.subsystem.createExecutionContext(
            controller.functions, controller.entityName,
        );
        try {
            const deleted = [];
            for (const record of pending.records) {
                const recordId = record[controller.primaryKey];
                if (typeof controller.subsystem?.runDeleteValidation === 'function') {
                    await controller.subsystem.runDeleteValidation(execContext, controller.parsedSkill, recordId, record);
                } else if (typeof controller.subsystem?.assertDeleteAllowed === 'function') {
                    await controller.subsystem.assertDeleteAllowed(controller.parsedSkill, recordId);
                }
                await execContext.deleteRecord(recordId);
                deleted.push(recordId);
            }
            return {
                success: true,
                operation: 'DELETE',
                message: `Deleted ${deleted.length} ${controller.entityName} record(s).`,
                count: deleted.length,
            };
        } catch (error) {
            return controller.buildCrudFailureResult(CRUD_OPERATIONS.DELETE, error);
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
        message: 'Please reply **yes** to delete or **no** to cancel.',
    };
}

export async function deleteFlow(controller, operation, execContext, sessionMemory) {
    const providedPrimaryKey = operation?.filter?.[controller.primaryKey] ?? operation?.data?.[controller.primaryKey];
    const hasProvidedPrimaryKey = controller.hasValue(providedPrimaryKey);

    const normalizedFilter = {
        ...(operation.filter || {}),
        ...(hasProvidedPrimaryKey ? { [controller.primaryKey]: String(providedPrimaryKey).trim() } : {}),
    };

    let records = await execContext.selectRecords(normalizedFilter);
    if ((!records || records.length === 0) && hasProvidedPrimaryKey) {
        // Fallback to case-insensitive / normalized PK matching when adapter filtering is strict.
        const allRecords = await execContext.selectRecords({});
        const normalizedTargetPk = controller.normalizePrimaryKeyForComparison(providedPrimaryKey);
        records = (allRecords || []).filter(record =>
            controller.normalizePrimaryKeyForComparison(record?.[controller.primaryKey]) === normalizedTargetPk,
        );
    }

    if (!records || records.length === 0) {
        return {
            success: false,
            operation: 'DELETE',
            message: `No ${controller.entityName} found matching your criteria.`,
        };
    }

    if (controller.requiresPrimaryKeyForCriticalOperation(CRUD_OPERATIONS.DELETE) && !hasProvidedPrimaryKey) {
        if (sessionMemory) {
            sessionMemory.set(pendingKey(controller.entityName, PENDING_STATE_SUFFIXES.DELETE_CAPTURE), {
                records,
                page: 0,
                pageSize: DEFAULT_SELECTION_PAGE_SIZE,
            });
        }
        return {
            success: true,
            operation: 'DELETE',
            requiresInput: true,
            message: controller.buildPrimaryKeyPrompt('delete', records, false, 0, DEFAULT_SELECTION_PAGE_SIZE),
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
    const table = formatRecordsTable(safePresented, controller.getListTableFields({ includePrimaryKey: true }), controller.entityName, {
        resolveLabel: (fieldName) => controller.getFieldLabel(fieldName, 'short'),
    });

    if (sessionMemory) {
        sessionMemory.set(pendingKey(controller.entityName, PENDING_STATE_SUFFIXES.DELETE), {
            records,
        });
    }

    return {
        success: true,
        operation: 'DELETE',
        requiresConfirmation: true,
        message: `About to delete ${records.length} ${controller.entityName} record(s):\n\n${table}\n\nReply **yes** to confirm or **no** to cancel.`,
    };
}
