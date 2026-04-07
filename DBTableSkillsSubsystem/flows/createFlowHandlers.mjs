import { resolveConfirmation } from '../../utils/ConfirmationUtils.mjs';
import { CRUD_OPERATIONS, PENDING_STATE_SUFFIXES, pendingKey } from '../constants.mjs';
import {
    buildExtractCreateDataPrompt,
    formatFieldInfo,
} from '../templates/prompts.mjs';
import {
    formatRecordTable,
    sanitizeRecordForUser,
    INTERNAL_RESPONSE_FIELDS,
} from '../helpers/conversationDisplayUtils.mjs';

const FRESH_OPERATION_PREFIX_RE = /^\s*(list|show|display|view|get|find|search|add|create|new|update|edit|change|delete|remove)\b/i;
const CONFIRMATION_PREFIX_RE = /^\s*(yes|y|no|n)\b/i;

function looksLikeFreshOperationPrompt(prompt) {
    const text = String(prompt || '').trim();
    if (!text) return false;
    if (CONFIRMATION_PREFIX_RE.test(text)) return false;
    return FRESH_OPERATION_PREFIX_RE.test(text);
}

export async function extractCreateDataFromInput(controller, prompt, pending) {
    const fieldInfo = formatFieldInfo(controller.fields);
    const extractionPrompt = buildExtractCreateDataPrompt(
        controller.entityName,
        pending?.record || {},
        pending?.requiredFields || [],
        pending?.missingFields || [],
        fieldInfo,
        prompt,
    );

    const extracted = await controller.llmAgent.executePrompt(extractionPrompt, {
        model: controller.modelConfig?.plan || 'plan',
        responseShape: 'json',
    });

    return controller.filterKnownFields(extracted?.data || {});
}

export async function prepareCreateForConfirmation(controller, record, execContext, sessionMemory) {
    const validation = execContext.validateRecord
        ? await execContext.validateRecord(record)
        : { isValid: true, errors: [] };

    if (!validation.isValid) {
        if (sessionMemory) {
            sessionMemory.set(pendingKey(controller.entityName, PENDING_STATE_SUFFIXES.VALIDATION), {
                operation: 'CREATE',
                record,
                errors: validation.errors,
            });
        }
        const errorList = controller.formatValidationErrorList(validation.errors, 'short');
        return {
            success: false,
            operation: 'CREATE',
            message: `Validation errors:\n- ${errorList}\n\nPlease provide corrections or type **cancel** to abort.`,
        };
    }

    if (sessionMemory) {
        sessionMemory.set(pendingKey(controller.entityName, PENDING_STATE_SUFFIXES.CREATE), {
            record,
        });
    }

    const table = formatRecordTable(record, controller.fields, [], {
        resolveLabel: (fieldName) => controller.getFieldLabel(fieldName, 'short'),
    });
    return {
        success: true,
        operation: 'CREATE',
        requiresConfirmation: true,
        message: `Create ${controller.entityName}:\n\n${table}\n\nReply **yes** to confirm or **no** to cancel.`,
    };
}

export async function handleCreateFieldCapture(controller, prompt, pending, sessionMemory, key) {
    const abortDecision = await resolveConfirmation(prompt, controller.llmAgent, {
        actionContext: `cancelling ${controller.entityName} creation`,
    });
    if (abortDecision === 'no' || controller.isAbortCommand(prompt)) {
        controller.clearCreatePendingStates(sessionMemory);
        return {
            success: true,
            operation: 'CREATE',
            message: 'Create cancelled.',
            cancelled: true,
        };
    }

    // User switched to a fresh command (e.g. "list ...", "update ...").
    // Drop create capture state and continue normal routing.
    if (looksLikeFreshOperationPrompt(prompt)) {
        controller.clearCreatePendingStates(sessionMemory);
        return null;
    }

    const execContext = controller.subsystem.createExecutionContext(
        controller.functions,
        controller.entityName,
    );

    let extractedData = {};
    try {
        extractedData = await extractCreateDataFromInput(controller, prompt, pending);
    } catch (error) {
        sessionMemory.set(key, pending);
        const errorMessage = controller.extractErrorMessage(error);
        return {
            success: false,
            operation: 'CREATE',
            requiresInput: true,
            message: `${controller.buildCreateCaptureMessage(pending, 'I could not process that input due to a system error.')}\n\nDetails: ${errorMessage}`,
        };
    }

    if (Object.keys(extractedData).length === 0) {
        sessionMemory.set(key, pending);
        return {
            success: true,
            operation: 'CREATE',
            requiresInput: true,
            message: controller.buildCreateCaptureMessage(
                pending,
                'I could not identify any field values in your message.',
            ),
        };
    }

    const mergedRecord = { ...(pending.record || {}), ...extractedData };
    const prepared = execContext.prepareRecord
        ? await execContext.prepareRecord(mergedRecord)
        : mergedRecord;

    const requiredFields = pending.requiredFields || controller.getRequiredCreateFields();
    const missingFields = controller.getMissingRequiredFields(prepared, requiredFields);
    const capturedFields = controller.formatFieldLabelList(Object.keys(extractedData), 'short');

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
            message: controller.buildCreateCaptureMessage(
                nextPending,
                `Captured field values: ${capturedFields}.`,
            ),
        };
    }

    sessionMemory.delete(key);
    return prepareCreateForConfirmation(controller, prepared, execContext, sessionMemory);
}

export async function handleCreateConfirmation(controller, prompt, pending, sessionMemory, key) {
    const abortDecision = await resolveConfirmation(prompt, controller.llmAgent, {
        actionContext: `cancelling ${controller.entityName} creation confirmation`,
    });
    if (abortDecision === 'no' || controller.isAbortCommand(prompt)) {
        controller.clearCreatePendingStates(sessionMemory);
        return {
            success: true,
            operation: 'CREATE',
            message: 'Create cancelled.',
            cancelled: true,
        };
    }

    const decision = await resolveConfirmation(prompt, controller.llmAgent, {
        actionContext: `confirming creation of ${controller.entityName}`,
    });

    if (decision === 'yes') {
        sessionMemory.delete(key);
        const execContext = controller.subsystem.createExecutionContext(
            controller.functions, controller.entityName,
        );
        try {
            const collisionRecord = await controller.findCreateCollisionRecord(pending.record, execContext);
            if (collisionRecord) {
                if (sessionMemory) {
                    sessionMemory.set(
                        pendingKey(controller.entityName, PENDING_STATE_SUFFIXES.CREATE_CONFLICT_UPDATE),
                        {
                            record: pending.record,
                            existingRecord: collisionRecord,
                        },
                    );
                }
                return {
                    success: true,
                    operation: 'CREATE',
                    requiresConfirmation: true,
                    message: controller.buildCreateConflictUpdateMessage(pending.record, collisionRecord),
                };
            }

            // Execute the insert
            await controller.writeProgress(`Creating ${controller.entityName}...`);
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
                message: `${controller.entityName} created successfully.`,
            };
        } catch (error) {
            return controller.buildCrudFailureResult(CRUD_OPERATIONS.CREATE, error);
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
        message: `Please reply **yes** to create the ${controller.entityName} or **no** to cancel.`,
    };
}

export async function handleCreateConflictUpdateConfirmation(
    controller,
    prompt,
    pending,
    sessionMemory,
    key,
) {
    const abortDecision = await resolveConfirmation(prompt, controller.llmAgent, {
        actionContext: `cancelling ${controller.entityName} create conflict resolution`,
    });
    if (abortDecision === 'no' || controller.isAbortCommand(prompt)) {
        controller.clearCreatePendingStates(sessionMemory);
        return {
            success: true,
            operation: 'CREATE',
            message: 'Operation cancelled.',
            cancelled: true,
        };
    }

    const decision = await resolveConfirmation(prompt, controller.llmAgent, {
        actionContext: `confirming update fallback for ${controller.entityName} create collision`,
    });

    if (decision === 'yes') {
        sessionMemory.delete(key);
        const execContext = controller.subsystem.createExecutionContext(
            controller.functions, controller.entityName,
        );

        try {
            const existingRecord = pending?.existingRecord || null;
            const newRecord = pending?.record || {};
            if (!existingRecord || !controller.hasValue(existingRecord?.[controller.primaryKey])) {
                return {
                    success: false,
                    operation: 'UPDATE',
                    message: `Cannot continue update: existing ${controller.entityName} record was not found.`,
                };
            }

            const changes = {};
            for (const [field, value] of Object.entries(newRecord)) {
                if (field === controller.primaryKey || INTERNAL_RESPONSE_FIELDS.has(field)) continue;
                if (!controller.valuesAreEquivalent(existingRecord[field], value)) {
                    changes[field] = value;
                }
            }

            if (Object.keys(changes).length === 0) {
                const presented = execContext.presentRecord
                    ? await execContext.presentRecord(existingRecord)
                    : existingRecord;
                return {
                    success: true,
                    operation: 'UPDATE',
                    record: sanitizeRecordForUser(presented),
                    message: `No changes were needed. ${controller.entityName} ${existingRecord[controller.primaryKey]} already matches the provided values.`,
                };
            }

            const patched = { ...existingRecord, ...changes };
            const prepared = execContext.prepareRecord
                ? await execContext.prepareRecord(patched)
                : patched;
            const validation = execContext.validateRecord
                ? await execContext.validateRecord(prepared)
                : { isValid: true, errors: [] };

            if (!validation.isValid) {
                const errorList = controller.formatValidationErrorList(validation.errors, 'short');
                return {
                    success: false,
                    operation: 'UPDATE',
                    message: `Cannot apply update because validation failed:\n- ${errorList}`,
                };
            }

            const recordId = existingRecord[controller.primaryKey];
            const updatePayload = { ...prepared };
            delete updatePayload[controller.primaryKey];
            delete updatePayload.id;

            await controller.writeProgress(`Updating existing ${controller.entityName}...`);
            const updateResult = await execContext.updateRecord(recordId, updatePayload);
            const updated = { ...existingRecord, ...updatePayload, ...updateResult };
            const presented = execContext.presentRecord
                ? await execContext.presentRecord(updated)
                : updated;

            return {
                success: true,
                operation: 'UPDATE',
                record: sanitizeRecordForUser(presented),
                message: `${controller.entityName} ${recordId} already existed. Updated successfully using the provided values.`,
            };
        } catch (error) {
            return controller.buildCrudFailureResult(CRUD_OPERATIONS.UPDATE, error);
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

    return {
        success: true,
        operation: 'CREATE',
        message: `Please reply **yes** to update the existing ${controller.entityName} or **no** to cancel.`,
    };
}

export async function createFlow(controller, operation, execContext, sessionMemory) {
    const newRecord = controller.filterKnownFields(operation.data || {});
    // Generate primary key only if caller did not provide one
    if (execContext.generatePKValues) {
        try {
            const hasPrimaryKey = Boolean(
                controller.primaryKey &&
                newRecord[controller.primaryKey] !== undefined &&
                newRecord[controller.primaryKey] !== null &&
                newRecord[controller.primaryKey] !== ''
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

    const requiredFields = controller.getRequiredCreateFields();
    const missingFields = controller.getMissingRequiredFields(prepared, requiredFields);
    if (missingFields.length > 0) {
        if (sessionMemory) {
            sessionMemory.set(pendingKey(controller.entityName, PENDING_STATE_SUFFIXES.CREATE_CAPTURE), {
                record: prepared,
                requiredFields,
                missingFields,
            });
        }
        return {
            success: true,
            operation: 'CREATE',
            requiresInput: true,
            message: controller.buildCreateCaptureMessage({
                record: prepared,
                requiredFields,
                missingFields,
            }),
        };
    }

    return prepareCreateForConfirmation(controller, prepared, execContext, sessionMemory);
}
