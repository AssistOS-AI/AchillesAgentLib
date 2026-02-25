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
    buildExtractFieldChangesPrompt,
    formatFieldInfoSimple,
} from '../templates/prompts.mjs';
import {
    paginateRecords,
    sanitizeRecordForUser,
} from '../helpers/conversationDisplayUtils.mjs';

function applyFilterFallbackEquivalent(controller, records, filter = {}) {
    if (!Array.isArray(records) || records.length === 0) return [];
    const entries = Object.entries(filter || {})
        .filter(([, expected]) => !(expected && typeof expected === 'object'));
    if (entries.length === 0) return records;

    return records.filter((record) => entries.every(([field, expected]) => {
        if (field === controller.primaryKey) {
            return controller.normalizePrimaryKeyForComparison(record?.[field])
                === controller.normalizePrimaryKeyForComparison(expected);
        }
        return controller.valuesAreEquivalent(record?.[field], expected);
    }));
}

function buildEffectiveChanges(controller, originalRecord, requestedChanges = {}, preparedRecord = {}) {
    const effective = {};
    for (const field of Object.keys(requestedChanges || {})) {
        if (field === controller.primaryKey || field === 'id') continue;
        const nextValue = Object.prototype.hasOwnProperty.call(preparedRecord || {}, field)
            ? preparedRecord[field]
            : requestedChanges[field];
        if (!controller.valuesAreEquivalent(originalRecord?.[field], nextValue)) {
            effective[field] = nextValue;
        }
    }
    return effective;
}

export async function handleUpdateConfirmation(controller, prompt, pending, sessionMemory, key) {
    const decision = await resolveConfirmation(prompt, controller.llmAgent, {
        actionContext: `confirming update of ${controller.entityName}`,
    });

    if (decision === 'yes') {
        sessionMemory.delete(key);
        await controller.writeProgress(`Updating ${controller.entityName}...`);
        const execContext = controller.subsystem.createExecutionContext(
            controller.functions, controller.entityName,
        );
        try {
            const recordId = pending.id;
            const updateResult = await execContext.updateRecord(recordId, pending.changes);
            const updated = { ...pending.original, ...pending.changes, ...updateResult };
            const presented = execContext.presentRecord
                ? await execContext.presentRecord(updated)
                : updated;
            const safeRecord = sanitizeRecordForUser(presented);

            // Build a compact change summary so the final UPDATE response is explicit.
            const changedFields = Object.keys(pending.changes || {});

            const changeTable = changedFields.length > 0
                ? changedFields.map((field) => {
                    const label = controller.getFieldLabel(field, 'short');
                    return `| ${label} | ${controller.formatDisplayValue(pending.original?.[field])} | ${controller.formatDisplayValue(pending.changes?.[field])} |`;
                }).join('\n')
                : '| — | — | — |';

            const message = changedFields.length > 0
                ? `${controller.entityName} updated successfully.\n\n| Field | Current | New |\n|-------|---------|-----|\n${changeTable}`
                : `${controller.entityName} updated successfully. No effective field changes were detected.`;

            return {
                success: true,
                operation: 'UPDATE',
                record: safeRecord,
                message,
            };
        } catch (error) {
            return controller.buildCrudFailureResult(CRUD_OPERATIONS.UPDATE, error);
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
        message: 'Please reply **yes** to apply the changes or **no** to cancel.',
    };
}

export async function prepareUpdateForRecord(
    controller,
    record,
    changes,
    execContext,
    sessionMemory,
    options = {},
) {
    const recordId = record[controller.primaryKey];
    const hasChanges = Object.keys(changes || {}).length > 0;
    const immutableNotice = controller.buildImmutableUpdateNotice(options?.blockedFields || []);

    if (!hasChanges) {
        // No changes specified - show current record and ask what to change
        if (sessionMemory) {
            sessionMemory.set(pendingKey(controller.entityName, PENDING_STATE_SUFFIXES.UPDATE_CAPTURE), {
                id: recordId,
                record,
            });
        }
        const presented = execContext.presentRecord
            ? await execContext.presentRecord(record)
            : record;
        const safeRecord = sanitizeRecordForUser(presented);
        return {
            success: true,
            operation: 'UPDATE',
            requiresInput: true,
            message: `Current ${controller.entityName} ${recordId}:\n\n${controller.buildUpdateCaptureInstructions(immutableNotice, safeRecord)}`,
        };
    }

    // Has changes - validate
    const patched = { ...record, ...changes };
    const prepared = execContext.prepareRecord
        ? await execContext.prepareRecord(patched)
        : patched;
    const validation = execContext.validateRecord
        ? await execContext.validateRecord(prepared)
        : { isValid: true, errors: [] };

    if (!validation.isValid) {
        if (sessionMemory) {
            sessionMemory.set(pendingKey(controller.entityName, PENDING_STATE_SUFFIXES.VALIDATION), {
                operation: 'UPDATE',
                record,
                changes,
                id: recordId,
                errors: validation.errors,
                blockedFields: options?.blockedFields || [],
            });
        }
        const errorList = controller.formatValidationErrorList(validation.errors, 'short');
        const noticeSection = immutableNotice ? `${immutableNotice}\n\n` : '';
        return {
            success: false,
            operation: 'UPDATE',
            message: `${noticeSection}Validation errors:\n- ${errorList}\n\nPlease provide corrections or type **cancel** to abort.`,
        };
    }

    const effectiveChanges = buildEffectiveChanges(controller, record, changes, prepared);
    if (Object.keys(effectiveChanges).length === 0) {
        return {
            success: true,
            operation: 'UPDATE',
            message: 'No effective field changes were detected.',
        };
    }

    // Show changes and ask for confirmation
    if (sessionMemory) {
        sessionMemory.set(pendingKey(controller.entityName, PENDING_STATE_SUFFIXES.UPDATE), {
            id: recordId,
            original: record,
            changes: effectiveChanges,
        });
    }

    const changeTable = Object.entries(effectiveChanges)
        .map(([field, value]) => {
            const label = controller.getFieldLabel(field, 'short');
            return `| ${label} | ${controller.formatDisplayValue(record[field])} | ${controller.formatDisplayValue(value)} |`;
        })
        .join('\n');

    return {
        success: true,
        operation: 'UPDATE',
        requiresConfirmation: true,
        message: `${immutableNotice ? `${immutableNotice}\n\n` : ''}Update ${controller.entityName} ${recordId}:\n\n| Field | Current | New |\n|-------|---------|-----|\n${changeTable}\n\nReply **yes** to apply or **no** to cancel.`,
    };
}

export async function handleUpdateTargetCapture(controller, prompt, pending, sessionMemory, key) {
    if (isNoResponse(prompt) || controller.isAbortCommand(prompt)) {
        controller.clearUpdatePendingStates(sessionMemory);
        return {
            success: true,
            operation: 'UPDATE',
            message: 'Update cancelled.',
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
            operation: 'UPDATE',
            requiresInput: true,
            message: `${boundaryMessage}${controller.buildPrimaryKeyPrompt('update', pending.records, false, pending.page, pending.pageSize)}`,
        };
    }

    const targetId = controller.extractPrimaryKeyFromPrompt(prompt, pending.records);
    if (!controller.hasValue(targetId)) {
        return {
            success: true,
            operation: 'UPDATE',
            requiresInput: true,
            message: controller.buildPrimaryKeyPrompt('update', pending.records, true, pending.page || 0, pending.pageSize || DEFAULT_SELECTION_PAGE_SIZE),
        };
    }

    const selectedRecord = (pending.records || []).find(record =>
        String(record?.[controller.primaryKey]).toLowerCase() === String(targetId).toLowerCase(),
    );
    if (!selectedRecord) {
        return {
            success: true,
            operation: 'UPDATE',
            requiresInput: true,
            message: controller.buildPrimaryKeyPrompt('update', pending.records, true, pending.page || 0, pending.pageSize || DEFAULT_SELECTION_PAGE_SIZE),
        };
    }

    sessionMemory.delete(key);
    const execContext = controller.subsystem.createExecutionContext(
        controller.functions,
        controller.entityName,
    );
    return prepareUpdateForRecord(
        controller,
        selectedRecord,
        pending.changes || {},
        execContext,
        sessionMemory,
        { blockedFields: pending.blockedFields || [] },
    );
}

export async function handleUpdateFieldCapture(controller, prompt, pending, sessionMemory, key) {
    if (controller.isAbortCommand(prompt)) {
        controller.clearUpdatePendingStates(sessionMemory);
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

    const fieldInfo = formatFieldInfoSimple(controller.getMutableUpdateFields());
    const extractPrompt = buildExtractFieldChangesPrompt(
        controller.entityName,
        pending.record,
        fieldInfo,
        prompt,
    );

    try {
        const extracted = await controller.llmAgent.executePrompt(extractPrompt, {
            mode: 'fast',
            responseShape: 'json',
        });

        const {
            changes,
            blockedFields: extractedBlockedFields,
        } = controller.sanitizeUpdateChanges(extracted?.changes || {}, {
            currentRecord: pending.record,
        });
        const mentionedBlockedFields = controller.detectImmutableFieldsMentionedInPrompt(prompt);
        const blockedFields = Array.from(new Set([
            ...(Array.isArray(extractedBlockedFields) ? extractedBlockedFields : []),
            ...(Array.isArray(mentionedBlockedFields) ? mentionedBlockedFields : []),
        ]));
        const blockedFieldsForNoChangeNotice = Array.from(new Set(
            Array.isArray(mentionedBlockedFields) ? mentionedBlockedFields : [],
        ));
        const immutableNotice = controller.buildImmutableUpdateNotice(
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
                message: controller.buildUpdateClarificationMessage(prompt, immutableNotice, pending.record),
            };
        }

        // Validate changes
        const execContext = controller.subsystem.createExecutionContext(
            controller.functions, controller.entityName,
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
            sessionMemory.set(pendingKey(controller.entityName, PENDING_STATE_SUFFIXES.VALIDATION), {
                operation: 'UPDATE',
                record: pending.record,
                changes,
                id: pending.id,
                errors: validation.errors,
                blockedFields,
            });
            const errorList = controller.formatValidationErrorList(validation.errors, 'short');
            return {
                success: false,
                operation: 'UPDATE',
                message: `${immutableNotice ? `${immutableNotice}\n\n` : ''}Validation errors:\n- ${errorList}\n\nPlease provide corrections or type **cancel** to abort.`,
            };
        }

        const effectiveChanges = buildEffectiveChanges(controller, pending.record, changes, prepared);
        if (Object.keys(effectiveChanges).length === 0) {
            return {
                success: true,
                operation: 'UPDATE',
                message: 'No effective field changes were detected.',
            };
        }

        // Show confirmation
        const changeTable = Object.entries(effectiveChanges)
            .map(([field, value]) => {
                const label = controller.getFieldLabel(field, 'short');
                return `| ${label} | ${controller.formatDisplayValue(pending.record[field])} | ${controller.formatDisplayValue(value)} |`;
            })
            .join('\n');

        const updateKey = pendingKey(controller.entityName, PENDING_STATE_SUFFIXES.UPDATE);
        sessionMemory.set(updateKey, {
            id: pending.id,
            original: pending.record,
            changes: effectiveChanges,
        });

        return {
            success: true,
            operation: 'UPDATE',
            requiresConfirmation: true,
            message: `${immutableNotice ? `${immutableNotice}\n\n` : ''}Proposed changes for ${controller.entityName} ${pending.id}:\n\n| Field | Current | New |\n|-------|---------|-----|\n${changeTable}\n\nReply **yes** to apply or **no** to cancel.`,
        };
    } catch (error) {
        if (sessionMemory) {
            sessionMemory.set(key, pending);
        }
        const errorMessage = controller.extractErrorMessage(error);
        return {
            success: false,
            operation: 'UPDATE',
            requiresInput: true,
            message: `I could not process that update request due to a system error.\n\n${controller.buildUpdateCaptureInstructions('', pending.record)}\n\nDetails: ${errorMessage}`,
        };
    }
}

export async function updateFlow(controller, operation, execContext, sessionMemory) {
    const providedPrimaryKey = operation?.filter?.[controller.primaryKey] ?? operation?.data?.[controller.primaryKey];
    const hasProvidedPrimaryKey = controller.hasValue(providedPrimaryKey);
    const normalizedFilter = {
        ...(operation.filter || {}),
        ...(hasProvidedPrimaryKey ? { [controller.primaryKey]: String(providedPrimaryKey).trim() } : {}),
    };

    let existing = await execContext.selectRecords(normalizedFilter);
    if ((!existing || existing.length === 0) && hasProvidedPrimaryKey) {
        // Fallback to case-insensitive / normalized PK matching when adapter filtering is strict.
        const allRecords = await execContext.selectRecords({});
        const normalizedTargetPk = controller.normalizePrimaryKeyForComparison(providedPrimaryKey);
        existing = (allRecords || []).filter(record =>
            controller.normalizePrimaryKeyForComparison(record?.[controller.primaryKey]) === normalizedTargetPk,
        );
    }
    if ((!existing || existing.length === 0) && Object.keys(normalizedFilter || {}).length > 0) {
        // General fallback when adapter filtering is strict/case-sensitive for non-PK fields.
        const allRecords = await execContext.selectRecords({});
        existing = applyFilterFallbackEquivalent(controller, allRecords || [], normalizedFilter);
    }
    if (!existing || existing.length === 0) {
        return {
            success: false,
            operation: 'UPDATE',
            message: `No ${controller.entityName} found matching your criteria.`,
        };
    }

    const baselineRecord = existing.length === 1 ? existing[0] : null;
    const { changes, blockedFields } = controller.sanitizeUpdateChanges(operation.data || {}, {
        currentRecord: baselineRecord,
    });
    if (controller.requiresPrimaryKeyForCriticalOperation(CRUD_OPERATIONS.UPDATE) && !hasProvidedPrimaryKey) {
        if (sessionMemory) {
            sessionMemory.set(pendingKey(controller.entityName, PENDING_STATE_SUFFIXES.UPDATE_TARGET_CAPTURE), {
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
            message: controller.buildPrimaryKeyPrompt('update', existing, false, 0, DEFAULT_SELECTION_PAGE_SIZE),
        };
    }

    const targetRecord = existing[0];
    return prepareUpdateForRecord(
        controller,
        targetRecord,
        changes,
        execContext,
        sessionMemory,
        { blockedFields },
    );
}
