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

function filterValidationErrorsToChangedFields(errors = [], changedFields = []) {
    const allowed = new Set((changedFields || []).map(field => String(field || '').trim()).filter(Boolean));
    if (allowed.size === 0) return [];
    return (errors || []).filter((issue) => {
        const field = String(issue?.field || '').trim();
        if (!field) return true;
        return allowed.has(field);
    });
}

function hasExplicitBulkUpdateIntent(prompt = '', operation = {}) {
    const text = `${String(prompt || '')} ${String(operation?.intent || '')}`.toLowerCase().trim();
    if (!text) return false;
    if (/\b(all|every|each|bulk|entire)\b/.test(text)) return true;
    if (/\bmove\b.+\bfrom\b.+\bto\b/.test(text) && /\b(records?|items?|materials?|equipment|areas?)\b/.test(text)) return true;
    return false;
}

function normalizeUpdateOperator(rawOperator = '') {
    const op = String(rawOperator || '').trim().toLowerCase();
    if (op === 'eq' || op === '=' ) return 'equals';
    if (op === 'ne' || op === '!=' || op === 'not_equal' || op === 'not_equals') return 'not_equals';
    if (op === 'contains') return 'contains';
    if (op === 'not_contains') return 'not_contains';
    if (op === 'starts_with') return 'starts_with';
    if (op === 'ends_with') return 'ends_with';
    if (op === 'in') return 'in';
    if (op === 'not_in') return 'not_in';
    if (op === 'gt' || op === '>') return 'gt';
    if (op === 'gte' || op === '>=') return 'gte';
    if (op === 'lt' || op === '<') return 'lt';
    if (op === 'lte' || op === '<=') return 'lte';
    if (op === 'between') return 'between';
    return op || 'equals';
}

function normalizeUpdatePostFilters(postFilters = []) {
    if (!Array.isArray(postFilters)) return [];
    return postFilters
        .map((entry) => ({
            field: String(entry?.field || '').trim(),
            operator: normalizeUpdateOperator(entry?.operator || 'equals'),
            value: entry?.value,
            valueTo: entry?.valueTo,
            joinWithPrevious: String(entry?.joinWithPrevious || 'and').trim().toLowerCase(),
        }))
        .filter(entry => entry.field);
}

function parseComparableValue(value) {
    if (value === null || value === undefined) return { kind: 'none', value: null };
    if (typeof value === 'number' && Number.isFinite(value)) return { kind: 'number', value };
    const text = String(value).trim();
    if (!text) return { kind: 'none', value: null };
    if (/^-?\d+(?:\.\d+)?$/.test(text)) return { kind: 'number', value: Number(text) };
    const date = new Date(text);
    if (!Number.isNaN(date.getTime())) return { kind: 'date', value: date.getTime() };
    return { kind: 'text', value: text.toLowerCase() };
}

function evaluateUpdatePostFilter(record, filter, controller) {
    const actualValue = record?.[filter.field];
    const actualText = String(actualValue ?? '').trim().toLowerCase();
    const expectedText = String(filter.value ?? '').trim().toLowerCase();

    if (filter.operator === 'contains') return actualText.includes(expectedText);
    if (filter.operator === 'not_contains') return !actualText.includes(expectedText);
    if (filter.operator === 'starts_with') return actualText.startsWith(expectedText);
    if (filter.operator === 'ends_with') return actualText.endsWith(expectedText);
    if (filter.operator === 'equals') return controller.valuesAreEquivalent(actualValue, filter.value);
    if (filter.operator === 'not_equals') return !controller.valuesAreEquivalent(actualValue, filter.value);
    if (filter.operator === 'in' || filter.operator === 'not_in') {
        const options = String(filter.value || '')
            .split(/\s*,\s*|\s+\bor\b\s+/i)
            .map(part => String(part).trim())
            .filter(Boolean);
        if (options.length === 0) return false;
        const inSet = options.some(candidate => controller.valuesAreEquivalent(actualValue, candidate));
        return filter.operator === 'in' ? inSet : !inSet;
    }

    const left = parseComparableValue(actualValue);
    const right = parseComparableValue(filter.value);
    if (left.kind === 'none' || right.kind === 'none') return false;
    if ((left.kind === 'date' || right.kind === 'date') && !(left.kind === 'date' && right.kind === 'date')) return false;
    if ((left.kind === 'number' || right.kind === 'number') && !(left.kind === 'number' && right.kind === 'number')) return false;

    if (filter.operator === 'gt') return left.value > right.value;
    if (filter.operator === 'gte') return left.value >= right.value;
    if (filter.operator === 'lt') return left.value < right.value;
    if (filter.operator === 'lte') return left.value <= right.value;
    if (filter.operator === 'between') {
        const upper = parseComparableValue(filter.valueTo);
        if (upper.kind === 'none' || upper.kind !== left.kind) return false;
        const min = right.value <= upper.value ? right.value : upper.value;
        const max = right.value <= upper.value ? upper.value : right.value;
        return left.value >= min && left.value <= max;
    }
    return false;
}

function applyUpdatePostFilters(records, postFilters = [], controller) {
    if (!Array.isArray(records) || records.length === 0) return [];
    const normalized = normalizeUpdatePostFilters(postFilters);
    if (normalized.length === 0) return records;

    return records.filter((record) => {
        const groups = [];
        let current = [];
        for (let i = 0; i < normalized.length; i++) {
            const condition = normalized[i];
            if (i > 0 && condition.joinWithPrevious === 'or') {
                groups.push(current);
                current = [];
            }
            current.push(condition);
        }
        groups.push(current);
        return groups.some(group => group.every(condition => evaluateUpdatePostFilter(record, condition, controller)));
    });
}

function buildBulkChangeTable(controller, plans = []) {
    const fields = Array.from(new Set(
        plans.flatMap(plan => Object.keys(plan?.changes || {})),
    ));
    if (fields.length === 0) return '| — | — | — |';

    return fields.map((field) => {
        const label = controller.getFieldLabel(field, 'short');
        const currentValues = Array.from(new Set(plans.map(plan => controller.formatDisplayValue(plan?.original?.[field]))));
        const newValues = Array.from(new Set(plans.map(plan => controller.formatDisplayValue(plan?.changes?.[field]))));
        const currentDisplay = currentValues.length === 1
            ? currentValues[0]
            : `${currentValues.length} values`;
        const newDisplay = newValues.length === 1
            ? newValues[0]
            : `${newValues.length} values`;
        return `| ${label} | ${currentDisplay} | ${newDisplay} |`;
    }).join('\n');
}

async function prepareBulkUpdateForRecords(
    controller,
    records,
    changes,
    execContext,
    sessionMemory,
    options = {},
) {
    const immutableNotice = controller.buildImmutableUpdateNotice(options?.blockedFields || []);
    const hasChanges = Object.keys(changes || {}).length > 0;
    if (!hasChanges) {
        return {
            success: true,
            operation: 'UPDATE',
            requiresInput: true,
            message: `${immutableNotice ? `${immutableNotice}\n\n` : ''}I found ${records.length} ${controller.entityName} record(s). Please specify field-value changes to apply to all matched records.`,
        };
    }

    const plans = [];
    const validationIssues = [];
    for (const record of records || []) {
        const patched = { ...record, ...changes };
        const prepared = execContext.prepareRecord
            ? await execContext.prepareRecord(patched)
            : patched;
        const effectiveChanges = buildEffectiveChanges(controller, record, changes, prepared);
        if (Object.keys(effectiveChanges).length === 0) continue;

        const validation = execContext.validateRecord
            ? await execContext.validateRecord(prepared)
            : { isValid: true, errors: [] };
        const relevantErrors = filterValidationErrorsToChangedFields(
            validation.errors || [],
            Object.keys(effectiveChanges),
        );

        if (!validation.isValid && relevantErrors.length > 0) {
            validationIssues.push({
                id: record?.[controller.primaryKey],
                errors: relevantErrors,
            });
            continue;
        }
        plans.push({
            id: record?.[controller.primaryKey],
            original: record,
            changes: effectiveChanges,
        });
    }

    if (validationIssues.length > 0) {
        const preview = validationIssues.slice(0, 3)
            .map((issue) => {
                const errorList = controller.formatValidationErrorList(issue.errors, 'short');
                return `- ${controller.formatDisplayValue(issue.id)}: ${errorList}`;
            })
            .join('\n');
        return {
            success: false,
            operation: 'UPDATE',
            message: `${immutableNotice ? `${immutableNotice}\n\n` : ''}Bulk update has validation errors:\n${preview}\n\nPlease refine your update request.`,
        };
    }

    if (plans.length === 0) {
        return {
            success: true,
            operation: 'UPDATE',
            message: 'No effective field changes were detected for the matched records.',
        };
    }

    if (sessionMemory) {
        sessionMemory.set(pendingKey(controller.entityName, PENDING_STATE_SUFFIXES.UPDATE), {
            mode: 'bulk',
            plans,
            totalMatched: records.length,
        });
    }

    const changeTable = buildBulkChangeTable(controller, plans);
    const sampleIds = plans.slice(0, 10).map(plan => controller.formatDisplayValue(plan.id)).join(', ');
    const moreCount = Math.max(plans.length - 10, 0);
    const idsLine = moreCount > 0 ? `${sampleIds}, +${moreCount} more` : sampleIds;

    return {
        success: true,
        operation: 'UPDATE',
        requiresConfirmation: true,
        message: `${immutableNotice ? `${immutableNotice}\n\n` : ''}Proposed bulk update for ${plans.length} ${controller.entityName} record(s) (matched ${records.length}):\n\n| Field | Current | New |\n|-------|---------|-----|\n${changeTable}\n\nTarget IDs: ${idsLine}\n\nReply **yes** to apply to all or **no** to cancel.`,
    };
}

async function tryRevisePendingUpdateChanges(controller, prompt, pending, sessionMemory) {
    const pendingChanges = pending?.changes && typeof pending.changes === 'object'
        ? pending.changes
        : {};
    const pendingFields = Object.keys(pendingChanges);
    if (pendingFields.length === 0) return null;

    const currentRecord = { ...(pending?.original || {}), ...pendingChanges };
    const fieldInfo = formatFieldInfoSimple(controller.getMutableUpdateFields());
    const singleFieldInstruction = pendingFields.length === 1
        ? `\nThe pending update currently changes only this field: "${pendingFields[0]}". If the user is clearly replacing the previously proposed value or says things like "change value to ...", interpret the message as the new value for that field.`
        : '';

    const extractPrompt = `Extract revised field changes from this user input for a "${controller.entityName}" record.

Current record with pending edits applied:
${JSON.stringify(currentRecord, null, 2)}

Previously pending changes:
${JSON.stringify(pendingChanges, null, 2)}

Available fields:
${fieldInfo}
${singleFieldInstruction}

User said: "${prompt}"

Respond with JSON: { "changes": { "fieldName": "newValue", ... } }
Rules:
- Prefer revising already-pending fields when the user is clarifying or replacing a value.
- Only include fields the user clearly wants to change now.
- Do not invent values.
- If the message is only a confirmation/cancellation or still ambiguous, return { "changes": {} }.`;

    const extracted = await controller.llmAgent.executePrompt(extractPrompt, {
        model: controller.modelConfig?.plan || 'plan',
        responseShape: 'json',
    });

    const {
        changes,
        blockedFields,
    } = controller.sanitizeUpdateChanges(extracted?.changes || {}, {
        currentRecord: pending?.original || null,
    });

    if (Object.keys(changes).length === 0) {
        return null;
    }

    const execContext = controller.subsystem.createExecutionContext(
        controller.functions,
        controller.entityName,
    );

    const mergedChanges = { ...pendingChanges, ...changes };
    return prepareUpdateForRecord(
        controller,
        pending.original,
        mergedChanges,
        execContext,
        sessionMemory,
        { blockedFields },
    );
}

export async function handleUpdateConfirmation(controller, prompt, pending, sessionMemory, key) {
    const decision = await resolveConfirmation(prompt, controller.llmAgent, {
        actionContext: `confirming update of ${controller.entityName}`,
    });

    if (decision === 'no') {
        sessionMemory.delete(key);
        return {
            success: true,
            operation: 'UPDATE',
            message: 'Update cancelled.',
            cancelled: true,
        };
    }

    try {
        const revised = await tryRevisePendingUpdateChanges(controller, prompt, pending, sessionMemory);
        if (revised) {
            return revised;
        }
    } catch {
        // Fall back to explicit yes/no clarification if revision extraction fails.
    }

    if (decision === 'yes') {
        sessionMemory.delete(key);
        await controller.writeProgress(`Updating ${controller.entityName}...`);
        const execContext = controller.subsystem.createExecutionContext(
            controller.functions, controller.entityName,
        );
        try {
            if (pending?.mode === 'bulk') {
                const plans = Array.isArray(pending?.plans) ? pending.plans : [];
                let updatedCount = 0;
                const failed = [];
                for (const plan of plans) {
                    try {
                        await execContext.updateRecord(plan.id, plan.changes);
                        updatedCount += 1;
                    } catch (error) {
                        failed.push({
                            id: plan.id,
                            error: controller.extractErrorMessage(error),
                        });
                    }
                }

                const failedLine = failed.length > 0
                    ? `\nFailed: ${failed.slice(0, 10).map(item => `${controller.formatDisplayValue(item.id)} (${item.error})`).join(', ')}${failed.length > 10 ? `, +${failed.length - 10} more` : ''}`
                    : '';

                return {
                    success: true,
                    operation: 'UPDATE',
                    updatedCount,
                    failedCount: failed.length,
                    message: `${controller.entityName} bulk update finished. Updated ${updatedCount}/${plans.length} record(s).${failedLine}`,
                };
            }

            const recordId = pending.id;
            const updateResult = await execContext.updateRecord(recordId, pending.changes);
            const updated = { ...pending.original, ...pending.changes, ...updateResult };
            const presented = execContext.presentRecord
                ? await execContext.presentRecord(updated)
                : updated;
            const safeRecord = sanitizeRecordForUser(presented);

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
    const effectiveChanges = buildEffectiveChanges(controller, record, changes, prepared);
    if (Object.keys(effectiveChanges).length === 0) {
        return {
            success: true,
            operation: 'UPDATE',
            message: 'No effective field changes were detected.',
        };
    }

    const validation = execContext.validateRecord
        ? await execContext.validateRecord(prepared)
        : { isValid: true, errors: [] };
    const relevantErrors = filterValidationErrorsToChangedFields(
        validation.errors || [],
        Object.keys(effectiveChanges),
    );

    if (!validation.isValid && relevantErrors.length > 0) {
        if (sessionMemory) {
            sessionMemory.set(pendingKey(controller.entityName, PENDING_STATE_SUFFIXES.VALIDATION), {
                operation: 'UPDATE',
                record,
                changes,
                id: recordId,
                errors: relevantErrors,
                blockedFields: options?.blockedFields || [],
            });
        }
        const errorList = controller.formatValidationErrorList(relevantErrors, 'short');
        const noticeSection = immutableNotice ? `${immutableNotice}\n\n` : '';
        return {
            success: false,
            operation: 'UPDATE',
            message: `${noticeSection}Validation errors:\n- ${errorList}\n\nPlease provide corrections or type **cancel** to abort.`,
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
    const abortDecision = await resolveConfirmation(prompt, controller.llmAgent, {
        actionContext: `cancelling ${controller.entityName} update target selection`,
    });
    if (abortDecision === 'no' || isNoResponse(prompt) || controller.isAbortCommand(prompt)) {
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
    const abortDecision = await resolveConfirmation(prompt, controller.llmAgent, {
        actionContext: `cancelling ${controller.entityName} update`,
    });
    if (abortDecision === 'no' || controller.isAbortCommand(prompt)) {
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
            model: controller.modelConfig?.plan || 'plan',
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
        const effectiveChanges = buildEffectiveChanges(controller, pending.record, changes, prepared);
        if (Object.keys(effectiveChanges).length === 0) {
            return {
                success: true,
                operation: 'UPDATE',
                message: 'No effective field changes were detected.',
            };
        }

        const validation = execContext.validateRecord
            ? await execContext.validateRecord(prepared)
            : { isValid: true, errors: [] };
        const relevantErrors = filterValidationErrorsToChangedFields(
            validation.errors || [],
            Object.keys(effectiveChanges),
        );

        if (!validation.isValid && relevantErrors.length > 0) {
            // Store for corrections
            sessionMemory.set(pendingKey(controller.entityName, PENDING_STATE_SUFFIXES.VALIDATION), {
                operation: 'UPDATE',
                record: pending.record,
                changes,
                id: pending.id,
                errors: relevantErrors,
                blockedFields,
            });
            const errorList = controller.formatValidationErrorList(relevantErrors, 'short');
            return {
                success: false,
                operation: 'UPDATE',
                message: `${immutableNotice ? `${immutableNotice}\n\n` : ''}Validation errors:\n- ${errorList}\n\nPlease provide corrections or type **cancel** to abort.`,
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
    const postFilters = normalizeUpdatePostFilters(operation?.postFilters || []);
    const bulkIntent = hasExplicitBulkUpdateIntent(operation?.__rawPrompt || '', operation);
    const hasTargeting = Object.keys(normalizedFilter || {}).length > 0 || postFilters.length > 0 || hasProvidedPrimaryKey;
    if (bulkIntent && !hasProvidedPrimaryKey && !hasTargeting) {
        return {
            success: false,
            operation: 'UPDATE',
            message: `I could not determine which ${controller.entityName} records to update in bulk. Please add a targeting condition (e.g., "where name contains ...", "from area A1").`,
        };
    }

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
    if (existing && existing.length > 0 && postFilters.length > 0) {
        existing = applyUpdatePostFilters(existing, postFilters, controller);
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
        if (existing.length === 1) {
            return prepareUpdateForRecord(
                controller,
                existing[0],
                changes,
                execContext,
                sessionMemory,
                { blockedFields },
            );
        }
        if (bulkIntent && existing.length > 1) {
            return prepareBulkUpdateForRecords(
                controller,
                existing,
                changes,
                execContext,
                sessionMemory,
                { blockedFields },
            );
        }
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
