import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { parseSkillMarkdown, validateSkill } from './SkillParser.mjs';
import { ConversationalTskillController } from './ConversationalTskillController.mjs';
import { tskillToSpecs } from './tskillToSpecs.mjs';
import { generateMirrorCode } from '../RecursiveSkilledAgents/mirror-code-generator/index.mjs';

const DEBUG_ENABLED = String(process.env.ACHILLES_DEBUG ?? process.env.ACHILES_DEBUG ?? '').toLowerCase() === 'true';

function debugLog(...args) {
    if (DEBUG_ENABLED) console.log(...args);
}

function debugWarn(...args) {
    if (DEBUG_ENABLED) console.warn(...args);
}

/**
 * Generate code using spec-based flow via mirror-code-generator.
 * @param {string} skillName - Name of the skill
 * @param {string} skillDir - Directory containing the skill
 * @param {Object} parsedSkill - Parsed skill object from SkillParser
 * @param {Object} llmAgent - LLM agent for code generation
 * @returns {Promise<void>}
 */
async function generateCodeViaSpecs(skillName, skillDir, parsedSkill, llmAgent) {
    debugLog(`[DBTableSkills] ──────────────────────────────────────────`);
    debugLog(`[DBTableSkills] Starting code generation for "${skillName}"`);
    debugLog(`[DBTableSkills] Step 1/2: Generating spec file...`);

    // 1. Generate spec file from parsed skill
    const specPath = await tskillToSpecs(skillDir, parsedSkill);
    debugLog(`[DBTableSkills] Spec written to: ${specPath}`);

    // 2. Run mirror-code-generator on the skill directory
    debugLog(`[DBTableSkills] Step 2/2: Running mirror-code-generator...`);
    const startTime = Date.now();

    const generatedFiles = await generateMirrorCode(skillDir, llmAgent, console);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    debugLog(`[DBTableSkills] Code generated in ${elapsed}s`);

    if (generatedFiles.length === 0) {
        throw new Error(`mirror-code-generator produced no files for "${skillName}"`);
    }

    debugLog(`[DBTableSkills] Generated files: ${generatedFiles.join(', ')}`);
    debugLog(`[DBTableSkills] ──────────────────────────────────────────`);
}

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
                    debugWarn(`Failed to register model "${parsedSkill.tableName}" with DB adapter:`, msg);
                }
                // Continue anyway
            }
        }

        // Generate functions if needed
        let functions;
        const generatedPath = tskillPath ? path.join(path.dirname(tskillPath), 'tskill.generated.mjs') : null;

        if (generatedPath && fs.existsSync(generatedPath)) {
            try {
                // Check if tskill.md or .specs.md is newer than generated file using timestamps
                const tskillStat = await fs.promises.stat(tskillPath);
                const generatedStat = await fs.promises.stat(generatedPath);
                let needsRegeneration = tskillStat.mtimeMs > generatedStat.mtimeMs;
                let regenReason = 'tskill.md was modified';

                // Also check specs/ directory if it exists
                const specsDir = path.join(path.dirname(tskillPath), 'specs');
                if (!needsRegeneration && fs.existsSync(specsDir)) {
                    try {
                        const specFiles = await fs.promises.readdir(specsDir);
                        for (const specFile of specFiles) {
                            if (specFile.endsWith('.md') || specFile.endsWith('.mds')) {
                                const specPath = path.join(specsDir, specFile);
                                const specStat = await fs.promises.stat(specPath);
                                if (specStat.mtimeMs > generatedStat.mtimeMs) {
                                    needsRegeneration = true;
                                    regenReason = `specs/${specFile} was modified`;
                                    break;
                                }
                            }
                        }
                    } catch (_e) {
                        // Ignore errors reading specs directory
                    }
                }

                if (!needsRegeneration) {
                    // Load existing generated file (use timestamp to bypass module cache)
                    debugLog(`[DBTableSkills] Loading cached code for "${name}" (up-to-date)`);
                    const moduleUrl = pathToFileURL(generatedPath).href + '?t=' + Date.now();
                    const imported = await import(moduleUrl);
                    // Support both formats: { functions: { global: ... } } or flat { prepareRecord, ... }
                    const rawFunctions = imported.functions || imported.default || imported;
                    functions = rawFunctions.global ? rawFunctions : { global: rawFunctions };
                } else {
                    // Source file is newer, regenerate using spec-based flow
                    debugLog(`[DBTableSkills] Regenerating "${name}" - ${regenReason}`);

                    // Generate code via specs and mirror-code-generator
                    await generateCodeViaSpecs(name, skillDir, parsedSkill, this.llmAgent);

                    // Re-import to get compiled functions
                    const newModuleUrl = pathToFileURL(generatedPath).href + '?t=' + Date.now();
                    const newImported = await import(newModuleUrl);
                    // Support both formats: { functions: { global: ... } } or flat { prepareRecord, ... }
                    const rawFunctions = newImported.functions || newImported.default || newImported;
                    functions = rawFunctions.global ? rawFunctions : { global: rawFunctions };
                }
            } catch (error) {
                console.error(`Error loading generated skill "${name}":`, error);
                // Fall through to fresh generation
            }
        }

        if (!functions) {
            debugLog(`[DBTableSkills] First-time generation for "${name}"...`);

            if (generatedPath) {
                // Generate code via specs and mirror-code-generator
                await generateCodeViaSpecs(name, skillDir, parsedSkill, this.llmAgent);

                const moduleUrl = pathToFileURL(generatedPath).href + '?t=' + Date.now();
                const imported = await import(moduleUrl);
                // Support both formats: { functions: { global: ... } } or flat { prepareRecord, ... }
                const rawFunctions = imported.functions || imported.default || imported;
                functions = rawFunctions.global ? rawFunctions : { global: rawFunctions };
            } else {
                // No output path - cannot generate
                debugWarn(`  Warning: No output path for skill "${name}", code not persisted`);
                functions = { global: {} };
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
     * Create an executor function for the skill.
     *
     * Uses ConversationalTskillController to wrap all operations with confirmation flows,
     * validation loops, and slot-filling. This is the single place for all
     * tskill conversation flow logic.
     */
    createExecutor(skillRecord, parsedSkill, functions) {
        const controller = new ConversationalTskillController(
            this,
            parsedSkill,
            functions,
            this.llmAgent,
        );

        return async ({ prompt }, context) => {
            if (!prompt || typeof prompt !== 'string') {
                throw new Error(`DBTable skill "${skillRecord.name}" requires a prompt argument`);
            }

            if (!this.llmAgent || typeof this.llmAgent.executePrompt !== 'function') {
                throw new Error(`DBTable skill "${skillRecord.name}" requires an LLMAgent`);
            }

            return withTimeout(
                controller.execute(prompt, context),
                SKILL_TIMEOUT_MS,
                () => new Error(`DBTable operation timed out`),
            );
        };
    }

    /**
     * Create execution context with all field functions available
     */
    createExecutionContext(functions, tableName) {
        const dbAdapter = this.dbAdapter;

        // If functions are already compiled (from module import), enhance them with DB operations
        // Check for prepareRecord or presentRecord since these are what the generated code exports
        // (selectRecords is not exported by generated code - it's added by this context)
        if (functions.global && (typeof functions.global.prepareRecord === 'function' || typeof functions.global.presentRecord === 'function')) {
            // Add DB operation functions to the existing context
            const enhanced = { ...functions.global };

            // Override selectRecords to use dbAdapter
            enhanced.selectRecords = async function selectRecords(filter) {
                if (!dbAdapter || typeof dbAdapter.query !== 'function') {
                    debugWarn('DBAdapter not available, returning empty array');
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

            // Add presentRecord function if not already defined
            // This creates a default that calls all presenter_* functions
            if (typeof enhanced.presentRecord !== 'function') {
                // Collect all presenter functions
                const presenterFns = {};
                for (const [key, fn] of Object.entries(enhanced)) {
                    if (key.startsWith('presenter_') && typeof fn === 'function') {
                        const fieldName = key.replace('presenter_', '');
                        presenterFns[fieldName] = fn;
                    }
                }

                enhanced.presentRecord = async function presentRecord(record) {
                    if (!record) return record;
                    const presented = { ...record };
                    for (const [fieldName, presenterFn] of Object.entries(presenterFns)) {
                        if (record[fieldName] !== undefined) {
                            try {
                                presented[fieldName] = await Promise.resolve(presenterFn(record[fieldName], record));
                            } catch (e) {
                                // Keep original value if presenter fails
                                debugWarn(`Presenter for ${fieldName} failed:`, e.message);
                            }
                        }
                    }
                    return presented;
                };
            }

            return enhanced;
        }

        // Build a code string that defines all field functions and returns an object with global functions
        const allPresenters = Object.values(functions.presenters || {}).join('\n\n');
        const allResolvers = Object.values(functions.resolvers || {}).join('\n\n');
        const allValidators = Object.values(functions.validators || {}).join('\n\n');
        const allEnumerators = Object.values(functions.enumerators || {}).join('\n\n');
        const allDerivators = Object.values(functions.derivators || {}).join('\n\n');

        const contextCode = `(function(dbAdapter, tableName, DEBUG_ENABLED) {

function debugWarn(...args) { if (DEBUG_ENABLED) console.warn(...args); }

// Override selectRecords to use dbAdapter
async function selectRecords(filter) {
    if (!dbAdapter || typeof dbAdapter.query !== 'function') {
        debugWarn('DBAdapter not available, returning empty array');
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
})(dbAdapter, tableName, DEBUG_ENABLED)`;

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
        } = options;
        const sessionMemory = options.sessionMemory
            || options.context?.sessionMemory
            || null;

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
