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
} from './constants.mjs';

/**
 * Format a record as a markdown table for display.
 * @param {Object} record - Record to format
 * @param {Object} fields - Field definitions from parsedSkill
 * @param {string[]} [excludeFields] - Fields to exclude from display
 * @returns {string} Markdown table
 */
function formatRecordTable(record, fields, excludeFields = []) {
    const hiddenFields = new Set([
        ...HIDDEN_AUDIT_FIELDS,
        ...excludeFields,
    ]);

    const rows = [];
    rows.push('| Field | Value |');
    rows.push('|-------|-------|');

    for (const [fieldName, fieldDef] of Object.entries(fields || {})) {
        if (hiddenFields.has(fieldName)) continue;
        const value = record[fieldName];
        const displayValue = value === undefined || value === null ? NULL_DISPLAY_VALUE : String(value);
        const label = fieldDef.description || fieldName;
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
function formatRecordsTable(records, fields, entityName) {
    if (!records || records.length === 0) {
        return `No ${entityName} records found.`;
    }

    const hiddenFields = new Set(HIDDEN_AUDIT_FIELDS);

    // Get visible field names
    const visibleFields = Object.entries(fields || {})
        .filter(([name]) => !hiddenFields.has(name));

    if (visibleFields.length === 0) return JSON.stringify(records, null, 2);

    const header = visibleFields.map(([, def]) => def.description || '').join(' | ');
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

    /**
     * Write progress message using IOServices if available.
     * Falls back silently if no output writer is configured.
     * @param {string} message - The progress message to write.
     * @returns {Promise<void>}
     */
    async writeProgress(message) {
        const writer = IOServices.getOutputWriter();
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
     * @returns {Promise<Object>} Result with { success, message, operation, ... }
     */
    async execute(prompt, context) {
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

        // Update confirmation
        const updateKey = pendingKey(this.entityName, PENDING_STATE_SUFFIXES.UPDATE);
        const pendingUpdate = sessionMemory.get(updateKey);
        if (pendingUpdate) {
            return this.handleUpdateConfirmation(prompt, pendingUpdate, sessionMemory, updateKey);
        }

        // Update field capture (user is specifying what to change)
        const captureKey = pendingKey(this.entityName, PENDING_STATE_SUFFIXES.UPDATE_CAPTURE);
        const pendingCapture = sessionMemory.get(captureKey);
        if (pendingCapture) {
            return this.handleUpdateFieldCapture(prompt, pendingCapture, sessionMemory, captureKey);
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

        return null;
    }

    async handleCreateConfirmation(prompt, pending, sessionMemory, key) {
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
                return {
                    success: true,
                    operation: 'CREATE',
                    record: presented,
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
                return {
                    success: true,
                    operation: 'UPDATE',
                    record: presented,
                    message: `${this.entityName} updated successfully.`,
                };
            } catch (error) {
                return {
                    success: false,
                    operation: 'UPDATE',
                    message: `Failed to update ${this.entityName}: ${error.message}`,
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

    async handleUpdateFieldCapture(prompt, pending, sessionMemory, key) {
        // The user is specifying what fields to change.
        // Use LLM to extract field changes from the prompt.
        sessionMemory.delete(key);

        const fieldInfo = Object.entries(this.fields)
            .map(([name, def]) => `- ${name}: ${def.description || name}`)
            .join('\n');

        const extractPrompt = `Extract the field changes from this user input for a "${this.entityName}" record.

Current record:
${JSON.stringify(pending.record, null, 2)}

Available fields:
${fieldInfo}

User said: "${prompt}"

Respond with JSON: { "changes": { "fieldName": "newValue", ... } }
Only include fields the user explicitly wants to change.`;

        try {
            const extracted = await this.llmAgent.executePrompt(extractPrompt, {
                mode: 'fast',
                responseShape: 'json',
            });

            const changes = extracted?.changes || {};
            if (Object.keys(changes).length === 0) {
                return {
                    success: true,
                    operation: 'UPDATE',
                    message: 'I could not determine which fields to change. Please specify the field and new value.\nFor example: "set name to New Name"',
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
                });
                const errorList = validation.errors
                    .map(e => typeof e === 'string' ? e : (e.error || e.message || JSON.stringify(e)))
                    .join('\n- ');
                return {
                    success: false,
                    operation: 'UPDATE',
                    message: `Validation errors:\n- ${errorList}\n\nPlease provide corrections or type **cancel** to abort.`,
                };
            }

            // Show confirmation
            const changeTable = Object.entries(changes)
                .map(([field, value]) => `| ${field} | ${pending.record[field] || '—'} | ${value} |`)
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
                message: `Proposed changes for ${this.entityName} ${pending.id}:\n\n| Field | Current | New |\n|-------|---------|-----|\n${changeTable}\n\nReply **yes** to apply or **no** to cancel.`,
            };
        } catch (error) {
            return {
                success: false,
                operation: 'UPDATE',
                message: `Failed to extract changes: ${error.message}`,
            };
        }
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
                return {
                    success: false,
                    operation: 'DELETE',
                    message: `Failed to delete ${this.entityName}: ${error.message}`,
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
        // Check for cancel
        if (isNoResponse(prompt) || /^cancel$/i.test(prompt.trim())) {
            sessionMemory.delete(key);
            return {
                success: true,
                operation: pending.operation,
                message: 'Operation cancelled.',
                cancelled: true,
            };
        }

        // Use LLM to apply corrections
        sessionMemory.delete(key);

        const errorList = (pending.errors || [])
            .map(e => typeof e === 'string' ? e : (e.error || e.message || JSON.stringify(e)))
            .join(', ');

        const correctionPrompt = `The user is correcting validation errors for a "${this.entityName}" record.

Previous errors: ${errorList}
Previous data: ${JSON.stringify(pending.changes || pending.record, null, 2)}

User's corrections: "${prompt}"

Available fields:
${Object.entries(this.fields).map(([n, d]) => `- ${n}: ${d.description || n}`).join('\n')}

Respond with JSON: { "correctedData": { ...all fields with corrections applied... } }`;

        try {
            const result = await this.llmAgent.executePrompt(correctionPrompt, {
                mode: 'fast',
                responseShape: 'json',
            });
            const corrected = result?.correctedData || {};

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
                });
                const newErrors = validation.errors
                    .map(e => typeof e === 'string' ? e : (e.error || e.message || JSON.stringify(e)))
                    .join('\n- ');
                return {
                    success: false,
                    operation: pending.operation,
                    message: `Still has validation errors:\n- ${newErrors}\n\nPlease provide corrections or type **cancel** to abort.`,
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
                    message: `Updated data is valid.\n\nReply **yes** to apply changes or **no** to cancel.`,
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
        const fieldInfo = Object.entries(this.fields)
            .map(([name, def]) => {
                let info = `- ${name}: ${def.description || name}`;
                if (def.aliases?.length > 0) {
                    info += ` (aliases: ${def.aliases.join(', ')})`;
                }
                return info;
            })
            .join('\n');

        const skillInstructions = this.parsedSkill.instructions
            ? `\nSkill-specific instructions:\n${this.parsedSkill.instructions}\n`
            : '';

        const operationPrompt = `Analyze this prompt and determine the database operation type:
"${prompt}"

For table: ${this.entityName}
Table purpose: ${this.parsedSkill.tablePurpose}
${skillInstructions}
Available fields:
${fieldInfo}

Respond with JSON:
{
    "operation": "CREATE" | "UPDATE" | "SELECT" | "DELETE",
    "intent": "description of what the user wants",
    "filter": {},
    "data": {}
}`;

        return this.llmAgent.executePrompt(operationPrompt, {
            mode: 'fast',
            responseShape: 'json',
        });
    }

    /**
     * CREATE flow: validate → store pending → ask confirmation
     */
    async createFlow(operation, execContext, sessionMemory) {
        const newRecord = operation.data || {};

        // Generate primary key
        if (execContext.generatePKValues) {
            try {
                const pkValues = execContext.generatePKValues({});
                Object.assign(newRecord, pkValues);
            } catch (_e) {
                // PK generation is optional
            }
        }

        // Prepare record
        const prepared = execContext.prepareRecord
            ? await execContext.prepareRecord(newRecord)
            : newRecord;

        // Validate
        const validation = execContext.validateRecord
            ? await execContext.validateRecord(prepared)
            : { isValid: true, errors: [] };

        if (!validation.isValid) {
            if (sessionMemory) {
                sessionMemory.set(pendingKey(this.entityName, PENDING_STATE_SUFFIXES.VALIDATION), {
                    operation: 'CREATE',
                    record: prepared,
                    errors: validation.errors,
                });
            }
            const errorList = validation.errors
                .map(e => typeof e === 'string' ? e : (e.error || e.message || JSON.stringify(e)))
                .join('\n- ');
            return {
                success: false,
                operation: 'CREATE',
                message: `Validation errors:\n- ${errorList}\n\nPlease provide corrections or type **cancel** to abort.`,
            };
        }

        // Store pending and ask for confirmation
        if (sessionMemory) {
            sessionMemory.set(pendingKey(this.entityName, PENDING_STATE_SUFFIXES.CREATE), {
                record: prepared,
            });
        }

        const table = formatRecordTable(prepared, this.fields);
        return {
            success: true,
            operation: 'CREATE',
            requiresConfirmation: true,
            message: `Create ${this.entityName}:\n\n${table}\n\nReply **yes** to confirm or **no** to cancel.`,
        };
    }

    /**
     * UPDATE flow: find record → show current → capture changes → validate → confirm
     */
    async updateFlow(operation, execContext, sessionMemory) {
        // Find existing records
        const existing = await execContext.selectRecords(operation.filter || {});

        if (!existing || existing.length === 0) {
            return {
                success: false,
                operation: 'UPDATE',
                message: `No ${this.entityName} found matching your criteria.`,
            };
        }

        const record = existing[0];
        const recordId = record[this.primaryKey];
        const changes = operation.data || {};
        const hasChanges = Object.keys(changes).length > 0;

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
            const table = formatRecordTable(presented, this.fields);
            return {
                success: true,
                operation: 'UPDATE',
                message: `Current ${this.entityName} ${recordId}:\n\n${table}\n\nWhat would you like to change? Specify the field and new value.`,
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
                });
            }
            const errorList = validation.errors
                .map(e => typeof e === 'string' ? e : (e.error || e.message || JSON.stringify(e)))
                .join('\n- ');
            return {
                success: false,
                operation: 'UPDATE',
                message: `Validation errors:\n- ${errorList}\n\nPlease provide corrections or type **cancel** to abort.`,
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
            .map(([field, value]) => `| ${field} | ${record[field] || '—'} | ${value} |`)
            .join('\n');

        return {
            success: true,
            operation: 'UPDATE',
            requiresConfirmation: true,
            message: `Update ${this.entityName} ${recordId}:\n\n| Field | Current | New |\n|-------|---------|-----|\n${changeTable}\n\nReply **yes** to apply or **no** to cancel.`,
        };
    }

    /**
     * SELECT flow: query + present
     */
    async selectFlow(operation, execContext, _sessionMemory) {
        const records = await execContext.selectRecords(operation.filter || {});

        if (!records || records.length === 0) {
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

        const table = formatRecordsTable(presented, this.fields, this.entityName);

        return {
            success: true,
            operation: 'SELECT',
            records: presented,
            count: presented.length,
            message: `Found ${presented.length} ${this.entityName}(s):\n\n${table}`,
        };
    }

    /**
     * DELETE flow: find records → show → ask confirmation
     */
    async deleteFlow(operation, execContext, sessionMemory) {
        const records = await execContext.selectRecords(operation.filter || {});

        if (!records || records.length === 0) {
            return {
                success: false,
                operation: 'DELETE',
                message: `No ${this.entityName} found matching your criteria.`,
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

        const table = formatRecordsTable(presented, this.fields, this.entityName);

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
