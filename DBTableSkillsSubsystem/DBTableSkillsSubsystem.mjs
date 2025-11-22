import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { parseSkillMarkdown, validateSkill } from './SkillParser.mjs';
import { generateAllFunctions, serializeFunctions } from './FunctionGenerator.mjs';

const DEFAULT_TIMEOUT_MS = 60000;
const DB_TABLE_ARGUMENT_NAME = 'prompt';

const parseTimeout = (value, fallback) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const SKILL_TIMEOUT_MS = parseTimeout(
    process.env.ACHILLES_DBTABLE_TIMEOUT
    ?? process.env.ACHILES_DBTABLE_TIMEOUT
    ?? process.env.ACHILESS_DBTABLE_TIMEOUT,
    DEFAULT_TIMEOUT_MS,
);

function withTimeout(promiseLike, timeoutMs, errorFactory) {
    let timerHandle;
    const timeoutPromise = new Promise((_, reject) => {
        timerHandle = setTimeout(() => {
            const produced = typeof errorFactory === 'function' ? errorFactory() : errorFactory;
            const error = produced instanceof Error
                ? produced
                : new Error(produced ? String(produced) : 'Operation timed out.');
            reject(error);
        }, timeoutMs);
        if (typeof timerHandle?.unref === 'function') {
            timerHandle.unref();
        }
    });

    const raceTarget = promiseLike instanceof Promise ? promiseLike : Promise.resolve(promiseLike);

    return Promise.race([raceTarget, timeoutPromise]).finally(() => {
        if (timerHandle) {
            clearTimeout(timerHandle);
        }
    });
}

function extractSectionContent(sections = {}, ...aliases) {
    if (!sections || typeof sections !== 'object') {
        return '';
    }
    for (const alias of aliases) {
        if (!alias) {
            continue;
        }
        const key = alias.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
        if (sections[key]) {
            return sections[key];
        }
    }
    return '';
}


/**
 * Main DBTableSkillsSubsystem class
 */
export class DBTableSkillsSubsystem {
    constructor({ llmAgent, dbAdapter, config = {} }) {
        this.llmAgent = llmAgent;
        this.dbAdapter = dbAdapter;
        this.skillsPath = config.skillsPath || './skills';
        this.generatedPath = config.generatedPath || './generated';
        this.cache = new Map();
        this.functionCache = new Map();
        this.executors = new Map();
    }

    /**
     * Prepare a skill for execution
     */
    async prepareSkill(skillRecord) {
        const { descriptor, skillDir, filePath, name } = skillRecord;

        // For DB Table skills, we expect a tskill.md file in the skill directory
        const tskillPath = skillDir ? path.join(skillDir, 'tskill.md') : null;

        if (!tskillPath || !fs.existsSync(tskillPath)) {
            throw new Error(`DBTable skill "${name}" requires a tskill.md file in the skill directory`);
        }

        // Read and parse the tskill.md file
        const content = await fs.promises.readFile(tskillPath, 'utf-8');
        const parsedSkill = parseSkillMarkdown(content);

        // Validate the parsed skill
        const validation = validateSkill(parsedSkill);
        if (!validation.isValid) {
            throw new Error(`Invalid skill definition for "${name}": ${validation.errors.join(', ')}`);
        }

        // Register model with DB Adapter if available
        if (this.dbAdapter) {
            try {
                if (typeof this.dbAdapter.addType === 'function') {
                    await this.dbAdapter.addType({
                        [parsedSkill.tableName]: parsedSkill.fields
                    });
                } else if (typeof this.dbAdapter.addModel === 'function') {
                    await this.dbAdapter.addModel({
                        name: parsedSkill.tableName,
                        fields: parsedSkill.fields,
                        description: parsedSkill.tablePurpose
                    });
                }
            } catch (error) {
                const msg = error.message || '';
                if (msg.includes('already exists') || msg.includes('Refusing to overwrite') || msg.includes('Function create')) {
                    // Model already registered, this is fine
                } else {
                    console.warn(`Failed to register model "${parsedSkill.tableName}" with DB adapter:`, msg);
                }
                // Continue anyway
            }
        }

        // Generate functions if needed
        let functions;
        const generatedPath = tskillPath ? path.join(path.dirname(tskillPath), 'tskill.generated.mjs') : null;

        if (generatedPath && fs.existsSync(generatedPath)) {
            try {
                // Load existing generated file
                // Use timestamp to bypass cache
                const moduleUrl = pathToFileURL(generatedPath).href + '?t=' + Date.now();
                const imported = await import(moduleUrl);

                // Check if content matches
                if (imported.tskillSource === content) {
                    functions = imported.functions;
                } else {
                    // Content changed, regenerate with context
                    console.log(`Regenerating skill "${name}" due to changes...`);
                    const generatedFunctions = await generateAllFunctions(name, parsedSkill, this.llmAgent, {
                        oldFunctions: imported.functions,
                        oldTskill: imported.tskillSource,
                        newTskill: content
                    });

                    // Serialize and write
                    const fileContent = serializeFunctions(generatedFunctions, content);
                    await fs.promises.writeFile(generatedPath, fileContent, 'utf-8');

                    // Re-import to get compiled functions
                    const newModuleUrl = pathToFileURL(generatedPath).href + '?t=' + Date.now();
                    const newImported = await import(newModuleUrl);
                    functions = newImported.functions;
                }
            } catch (error) {
                console.error(`Error loading generated skill "${name}":`, error);
                // Fall through to fresh generation
            }
        }

        if (!functions) {
            const generatedFunctions = await generateAllFunctions(name, parsedSkill, this.llmAgent, {
                newTskill: content
            });

            if (generatedPath) {
                const fileContent = serializeFunctions(generatedFunctions, content);
                await fs.promises.writeFile(generatedPath, fileContent, 'utf-8');

                const moduleUrl = pathToFileURL(generatedPath).href + '?t=' + Date.now();
                const imported = await import(moduleUrl);
                functions = imported.functions;
            } else {
                functions = generatedFunctions;
            }
        }

        // Store metadata
        skillRecord.metadata = {
            type: 'dbtable',
            tableName: parsedSkill.tableName,
            tablePurpose: parsedSkill.tablePurpose,
            fields: parsedSkill.fields,
            functions: functions,
            filePath: tskillPath,
            skillDir,
            title: descriptor?.title || parsedSkill.tableName,
            summary: descriptor?.summary || parsedSkill.tablePurpose,
            body: descriptor?.body || null,
            sections: descriptor?.sections || {},
            defaultArgument: DB_TABLE_ARGUMENT_NAME
        };

        // Create executor
        const executor = this.createExecutor(skillRecord, parsedSkill, functions);
        this.executors.set(name, executor);

        // Store parsed skill in cache
        this.cache.set(name, parsedSkill);
    }

    /**
     * Create an executor function for the skill
     */
    createExecutor(skillRecord, parsedSkill, functions) {
        return async ({ prompt }, context) => {
            if (!prompt || typeof prompt !== 'string') {
                throw new Error(`DBTable skill "${skillRecord.name}" requires a prompt argument`);
            }

            if (!this.llmAgent || typeof this.llmAgent.executePrompt !== 'function') {
                throw new Error(`DBTable skill "${skillRecord.name}" requires an LLMAgent`);
            }

            // Determine the operation type from the prompt
            const operationPrompt = `Analyze this prompt and determine the database operation type:
"${prompt}"

For table: ${parsedSkill.tableName}
Table purpose: ${parsedSkill.tablePurpose}

Respond with JSON:
{
    "operation": "CREATE" | "UPDATE" | "SELECT" | "DELETE",
    "intent": "description of what the user wants",
    "filter": {} // for SELECT/UPDATE/DELETE operations,
    "data": {} // for CREATE/UPDATE operations
}`;

            const operation = await withTimeout(
                this.llmAgent.executePrompt(operationPrompt, {
                    mode: 'fast',
                    responseShape: 'json'
                }),
                SKILL_TIMEOUT_MS,
                () => new Error(`DBTable operation analysis timed out`)
            );

            // Execute the appropriate operation flow
            let result;
            switch (operation.operation) {
                case 'CREATE':
                    result = await this.executeCreateFlow(parsedSkill, functions, operation, context);
                    break;
                case 'UPDATE':
                    result = await this.executeUpdateFlow(parsedSkill, functions, operation, context);
                    break;
                case 'SELECT':
                    result = await this.executeSelectFlow(parsedSkill, functions, operation, context);
                    break;
                case 'DELETE':
                    result = await this.executeDeleteFlow(parsedSkill, functions, operation, context);
                    break;
                default:
                    throw new Error(`Unknown operation type: ${operation.operation}`);
            }

            return result;
        };
    }

    /**
     * Create execution context with all field functions available
     */
    createExecutionContext(functions, tableName) {
        const dbAdapter = this.dbAdapter;

        // If functions are already compiled (from module import), enhance them with DB operations
        if (functions.global && typeof functions.global.selectRecords === 'function') {
            // Add DB operation functions to the existing context
            const enhanced = { ...functions.global };

            // Override selectRecords to use dbAdapter
            enhanced.selectRecords = async function selectRecords(filter) {
                if (!dbAdapter || typeof dbAdapter.query !== 'function') {
                    console.warn('DBAdapter not available, returning empty array');
                    return [];
                }
                try {
                    const records = await dbAdapter.query(tableName, filter);
                    return Array.isArray(records) ? records : [];
                } catch (error) {
                    console.error('Error querying ' + tableName + ':', error);
                    return [];
                }
            };

            // Add insertRecord function
            enhanced.insertRecord = async function insertRecord(record) {
                if (!dbAdapter || typeof dbAdapter.insert !== 'function') {
                    throw new Error('DBAdapter not available for insert operation');
                }
                return await dbAdapter.insert(tableName, record);
            };

            // Add updateRecord function
            enhanced.updateRecord = async function updateRecord(id, data) {
                if (!dbAdapter || typeof dbAdapter.update !== 'function') {
                    throw new Error('DBAdapter not available for update operation');
                }
                return await dbAdapter.update(tableName, id, data);
            };

            // Add deleteRecord function
            enhanced.deleteRecord = async function deleteRecord(id) {
                if (!dbAdapter || typeof dbAdapter.delete !== 'function') {
                    throw new Error('DBAdapter not available for delete operation');
                }
                return await dbAdapter.delete(tableName, id);
            };

            return enhanced;
        }

        // Build a code string that defines all field functions and returns an object with global functions
        const allPresenters = Object.values(functions.presenters || {}).join('\n\n');
        const allResolvers = Object.values(functions.resolvers || {}).join('\n\n');
        const allValidators = Object.values(functions.validators || {}).join('\n\n');
        const allEnumerators = Object.values(functions.enumerators || {}).join('\n\n');
        const allDerivators = Object.values(functions.derivators || {}).join('\n\n');

        const contextCode = `(function(dbAdapter, tableName) {

// Override selectRecords to use dbAdapter
async function selectRecords(filter) {
    if (!dbAdapter || typeof dbAdapter.query !== 'function') {
        console.warn('DBAdapter not available, returning empty array');
        return [];
    }
    try {
        const records = await dbAdapter.query(tableName, filter);
        return Array.isArray(records) ? records : [];
    } catch (error) {
        console.error('Error querying ' + tableName + ':', error);
        return [];
    }
}

// Override insertRecord to use dbAdapter
async function insertRecord(record) {
    if (!dbAdapter || typeof dbAdapter.insert !== 'function') {
        throw new Error('DBAdapter not available for insert operation');
    }
    return await dbAdapter.insert(tableName, record);
}

// Override updateRecord to use dbAdapter
async function updateRecord(id, data) {
    if (!dbAdapter || typeof dbAdapter.update !== 'function') {
        throw new Error('DBAdapter not available for update operation');
    }
    return await dbAdapter.update(tableName, id, data);
}

// Override deleteRecord to use dbAdapter
async function deleteRecord(id) {
    if (!dbAdapter || typeof dbAdapter.delete !== 'function') {
        throw new Error('DBAdapter not available for delete operation');
    }
    return await dbAdapter.delete(tableName, id);
}

${functions.global.prepareRecord || ''}

${functions.global.validateRecord || ''}

${functions.global.presentRecord || ''}

${functions.global.generatePKValues || ''}

// Return object with global functions
return {
    generatePKValues: typeof generatePKValues !== 'undefined' ? generatePKValues : null,
    prepareRecord: typeof prepareRecord !== 'undefined' ? prepareRecord : null,
    validateRecord: typeof validateRecord !== 'undefined' ? validateRecord : null,
    presentRecord: typeof presentRecord !== 'undefined' ? presentRecord : null,
    selectRecords: selectRecords,
    insertRecord: insertRecord,
    updateRecord: updateRecord,
    deleteRecord: deleteRecord
};
})(dbAdapter, tableName)`;

        // Debug generated code
        // console.log('Generated Context Code:', contextCode);
        try {
            return eval(contextCode);
        } catch (e) {
            console.error('Error evaluating context code:', e);
            console.error('Code was:', contextCode);
            throw e;
        }
    }

    /**
     * Execute CREATE operation flow
     */
    async executeCreateFlow(parsedSkill, functions, operation, context) {
        // Generate initial record from AI intent
        const newRecord = operation.data || {};

        // Create execution context with all functions
        const tableName = parsedSkill.tableName || 'unknown';
        const execContext = this.createExecutionContext(functions, tableName);

        // Generate primary key if needed
        if (execContext.generatePKValues) {
            const pkValues = execContext.generatePKValues({});
            Object.assign(newRecord, pkValues);
        }

        // Prepare record
        const prepared = await execContext.prepareRecord(newRecord);

        // Validate record
        const validation = await execContext.validateRecord(prepared);

        if (!validation.isValid) {
            return {
                success: false,
                errors: validation.errors,
                operation: 'CREATE'
            };
        }

        // Actually insert the record into the database
        try {
            const insertResult = await execContext.insertRecord(prepared);

            // Merge the insert result (which may just be { id }) with the prepared data
            // to get a complete record for presentation
            const insertedRecord = { ...prepared, ...insertResult };

            // Present the inserted record
            const presented = await execContext.presentRecord(insertedRecord);

            return {
                success: true,
                operation: 'CREATE',
                record: presented,
                requiresConfirmation: true,
                message: `Successfully created ${parsedSkill.tableName || 'record'}`
            };
        } catch (error) {
            return {
                success: false,
                operation: 'CREATE',
                error: error.message || 'Failed to insert record'
            };
        }
    }

    /**
     * Execute UPDATE operation flow
     */
    async executeUpdateFlow(parsedSkill, functions, operation, context) {
        // Create execution context with all functions
        const tableName = parsedSkill.tableName || 'unknown';
        const execContext = this.createExecutionContext(functions, tableName);

        // Get existing record from database
        const existing = await execContext.selectRecords(operation.filter);

        if (!existing || existing.length === 0) {
            return {
                success: false,
                error: 'No records found matching the filter',
                operation: 'UPDATE'
            };
        }

        // Patch with intended changes
        const patched = { ...existing[0], ...operation.data };

        // Prepare record
        const prepared = await execContext.prepareRecord(patched);

        // Validate record
        const validation = await execContext.validateRecord(prepared);

        if (!validation.isValid) {
            return {
                success: false,
                errors: validation.errors,
                operation: 'UPDATE'
            };
        }

        // Actually update the record in the database
        try {
            // Get the primary key field name
            const primaryKey = parsedSkill.primaryKey || `${parsedSkill.tableName}_id`;
            const recordId = existing[0][primaryKey];

            if (!recordId) {
                throw new Error(`Primary key ${primaryKey} not found in record`);
            }

            const updateResult = await execContext.updateRecord(recordId, prepared);

            // Merge the update result with the prepared data to get a complete record
            const updatedRecord = { ...prepared, ...updateResult };

            // Present the updated record
            const presented = await execContext.presentRecord(updatedRecord);

            return {
                success: true,
                operation: 'UPDATE',
                record: presented,
                original: existing[0],
                requiresConfirmation: true,
                message: `Successfully updated ${parsedSkill.tableName || 'record'}`
            };
        } catch (error) {
            return {
                success: false,
                operation: 'UPDATE',
                error: error.message || 'Failed to update record'
            };
        }
    }

    /**
     * Execute SELECT operation flow
     */
    async executeSelectFlow(parsedSkill, functions, operation, context) {
        // Create execution context with all functions
        const tableName = parsedSkill.tableName || 'unknown';
        const execContext = this.createExecutionContext(functions, tableName);

        // Select records
        const records = await execContext.selectRecords(operation.filter);

        // Present each record
        const presented = await Promise.all(
            records.map(record => execContext.presentRecord(record))
        );

        return {
            success: true,
            operation: 'SELECT',
            records: presented,
            count: presented.length
        };
    }

    /**
     * Execute DELETE operation flow
     */
    async executeDeleteFlow(parsedSkill, functions, operation, context) {
        // Create execution context with all functions
        const tableName = parsedSkill.tableName || 'unknown';
        const execContext = this.createExecutionContext(functions, tableName);

        // Select records to delete
        const records = await execContext.selectRecords(operation.filter);

        if (!records || records.length === 0) {
            return {
                success: false,
                error: 'No records found matching the filter',
                operation: 'DELETE'
            };
        }

        // Actually delete the records from the database
        try {
            // Get the primary key field name
            const primaryKey = parsedSkill.primaryKey || `${parsedSkill.tableName}_id`;
            const deletedRecords = [];

            for (const record of records) {
                const recordId = record[primaryKey];
                if (!recordId) {
                    throw new Error(`Primary key ${primaryKey} not found in record`);
                }

                await execContext.deleteRecord(recordId);
                const presented = await execContext.presentRecord(record);
                deletedRecords.push(presented);
            }

            return {
                success: true,
                operation: 'DELETE',
                records: deletedRecords,
                count: deletedRecords.length,
                requiresConfirmation: true,
                message: `Successfully deleted ${deletedRecords.length} ${parsedSkill.tableName || 'record'}(s)`
            };
        } catch (error) {
            return {
                success: false,
                operation: 'DELETE',
                error: error.message || 'Failed to delete records'
            };
        }
    }

    /**
     * Execute a skill prompt
     */
    async executeSkillPrompt({ skillRecord, promptText, options = {} }) {
        const executor = this.executors.get(skillRecord.name);
        if (!executor) {
            throw new Error(`Executor not prepared for DBTable skill "${skillRecord.name}"`);
        }

        const {
            args = {},
            sessionMemory = null,
        } = options;

        const prompt = typeof args[DB_TABLE_ARGUMENT_NAME] === 'string' && args[DB_TABLE_ARGUMENT_NAME].trim()
            ? args[DB_TABLE_ARGUMENT_NAME]
            : String(promptText ?? '').trim();

        if (!prompt) {
            throw new Error(`DBTable skill "${skillRecord.name}" requires a prompt`);
        }

        const result = await executor({ prompt }, { sessionMemory });

        return {
            skill: skillRecord.name,
            metadata: skillRecord.metadata || null,
            result,
            sessionMemory,
        };
    }
}