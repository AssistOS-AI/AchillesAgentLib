import { isNoResponse } from '../../utils/ConfirmationUtils.mjs';
import { PENDING_STATE_SUFFIXES, pendingKey } from '../constants.mjs';
import {
    buildValidationCorrectionPrompt,
    formatFieldInfoSimple,
} from '../templates/prompts.mjs';
import { formatRecordTable } from '../helpers/conversationDisplayUtils.mjs';

const SELECT_CMD_RE = /^(list|show|display|view|get|find|search)\b/i;
const CREATE_CMD_RE = /^(create|add|new|insert|make|register)\b/i;
const DELETE_CMD_RE = /^(delete|remove|drop|erase)\b/i;
const UPDATE_CMD_RE = /^(update|edit|change|modify)\b/i;
const GLOBAL_CMD_RE = /^(help|import|wipe|exit|quit)\b/i;
const ENTITY_HINT_RE = /\b(area|areas|equipment|equipments|material|materials|job|jobs)\b/i;

function isLikelyNewCommand(prompt) {
    const text = String(prompt || '').trim();
    if (!text) return false;
    if (SELECT_CMD_RE.test(text)) return true;
    if (CREATE_CMD_RE.test(text)) return true;
    if (DELETE_CMD_RE.test(text)) return true;
    if (GLOBAL_CMD_RE.test(text)) return true;
    // "set/assign/mark" are often valid correction phrases; do not auto-switch on those.
    if (UPDATE_CMD_RE.test(text) && ENTITY_HINT_RE.test(text)) return true;
    return false;
}

export async function handleValidationCorrections(controller, prompt, pending, sessionMemory, key) {
    // Check for cancel/abort
    const trimmedPrompt = String(prompt || '').trim();
    const shouldAbort = isNoResponse(prompt) || /^cancel$/i.test(trimmedPrompt) || controller.isAbortCommand(trimmedPrompt);
    if (shouldAbort) {
        if (pending.operation === 'CREATE') {
            controller.clearCreatePendingStates(sessionMemory);
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

    // If user typed a new command, exit validation mode and let normal routing handle it.
    if (isLikelyNewCommand(trimmedPrompt)) {
        if (pending.operation === 'CREATE') {
            controller.clearCreatePendingStates(sessionMemory);
        } else {
            sessionMemory.delete(key);
        }
        return null;
    }

    // Use LLM to apply corrections
    sessionMemory.delete(key);

    const errorList = controller.formatValidationErrorList(pending.errors || [], 'short');

    const correctionFields = pending.operation === 'UPDATE'
        ? controller.getMutableUpdateFields()
        : controller.fields;
    const fieldInfo = formatFieldInfoSimple(correctionFields);
    const correctionPrompt = buildValidationCorrectionPrompt(
        controller.entityName,
        errorList,
        pending.changes || pending.record,
        prompt,
        fieldInfo,
    );

    try {
        const result = await controller.llmAgent.executePrompt(correctionPrompt, {
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
            const sanitized = controller.sanitizeUpdateChanges(merged, {
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

        const immutableNotice = controller.buildImmutableUpdateNotice(blockedFields);

        // Re-validate
        const execContext = controller.subsystem.createExecutionContext(
            controller.functions, controller.entityName,
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
            const newErrors = controller.formatValidationErrorList(validation.errors, 'short');
            return {
                success: false,
                operation: pending.operation,
                message: `${immutableNotice ? `${immutableNotice}\n\n` : ''}Still has validation errors:\n- ${newErrors}\n\nPlease provide corrections or type **cancel** to abort.`,
            };
        }

        // Valid — proceed based on operation type
        if (pending.operation === 'CREATE') {
            const createKey = pendingKey(controller.entityName, PENDING_STATE_SUFFIXES.CREATE);
            sessionMemory.set(createKey, { record: prepared });
            const table = formatRecordTable(prepared, controller.fields, [], {
                resolveLabel: (fieldName) => controller.getFieldLabel(fieldName, 'short'),
            });
            return {
                success: true,
                operation: 'CREATE',
                requiresConfirmation: true,
                message: `Create ${controller.entityName}:\n\n${table}\n\nReply **yes** to confirm or **no** to cancel.`,
            };
        }

        if (pending.operation === 'UPDATE') {
            const updateKey = pendingKey(controller.entityName, PENDING_STATE_SUFFIXES.UPDATE);
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
        return controller.buildCrudFailureResult(pending.operation, error);
    }
}
