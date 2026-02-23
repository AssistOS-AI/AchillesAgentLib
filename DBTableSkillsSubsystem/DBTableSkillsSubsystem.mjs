import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { parseSkillMarkdown, validateSkill } from './SkillParser.mjs';
import { ConversationalTskillController } from './ConversationalTskillController.mjs';
import { tskillToSpecs } from './tskillToSpecs.mjs';
import { generateMirrorCode } from '../RecursiveSkilledAgents/mirror-code-generator/index.mjs';

const DEBUG_ENABLED = String(process.env.ACHILLES_DEBUG ?? '').toLowerCase() === 'true';

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

function normalizeIdentifier(value) {
    return String(value || '').trim().toLowerCase();
}

function parseTableFieldRef(value) {
    const text = String(value || '').trim();
    if (!text) return null;
    const match = text.match(/^([a-zA-Z_][\w]*)\s*\.\s*([a-zA-Z_][\w]*)$/);
    if (!match) return null;
    return {
        table: match[1],
        field: match[2],
    };
}

function parseFieldReferenceExpression(value) {
    const text = String(value || '').trim();
    if (!text) return null;
    const match = text.match(
        /([a-zA-Z_][\w]*\.[a-zA-Z_][\w]*)\s*(?:references|->|=>)\s*([a-zA-Z_][\w]*\.[a-zA-Z_][\w]*)/i,
    );
    if (!match) return null;
    const source = parseTableFieldRef(match[1]);
    const target = parseTableFieldRef(match[2]);
    if (!source || !target) return null;
    return { source, target };
}

function dedupeDependencies(dependencies = []) {
    const deduped = [];
    const seen = new Set();
    for (const dependency of dependencies) {
        const tableName = String(dependency?.tableName || '').trim();
        const foreignKey = String(dependency?.foreignKey || '').trim();
        if (!tableName || !foreignKey) continue;
        const key = `${normalizeIdentifier(tableName)}:${normalizeIdentifier(foreignKey)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push({ tableName, foreignKey });
    }
    return deduped;
}

const YES_CONFIRM_ACTIONS = new Set([
    'execute', 'confirm', 'confirmed', 'approve', 'approved', 'proceed', 'run', 'apply',
]);
const NO_CONFIRM_ACTIONS = new Set([
    'cancel', 'abort', 'reject', 'decline', 'stop', 'deny',
]);

function parseJsonPromptIfPossible(value) {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (!(trimmed.startsWith('{') || trimmed.startsWith('[') || trimmed.startsWith('"'))) return null;
    try {
        return JSON.parse(trimmed);
    } catch {
        return null;
    }
}

function normalizeActionPrompt(value) {
    const action = String(value ?? '').trim();
    if (!action) return '';
    const lower = action.toLowerCase();
    if (YES_CONFIRM_ACTIONS.has(lower)) return 'yes';
    if (NO_CONFIRM_ACTIONS.has(lower)) return 'no';
    return action;
}

function extractPromptInput(input, depth = 0) {
    if (depth > 5 || input == null) return '';

    if (typeof input === 'boolean') {
        return input ? 'yes' : 'no';
    }

    if (typeof input === 'string') {
        const trimmed = input.trim();
        if (!trimmed) return '';

        const parsed = parseJsonPromptIfPossible(trimmed);
        if (parsed !== null) {
            const parsedPrompt = extractPromptInput(parsed, depth + 1);
            if (parsedPrompt) return parsedPrompt;
        }

        return normalizeActionPrompt(trimmed);
    }

    if (Array.isArray(input)) {
        for (const item of input) {
            const prompt = extractPromptInput(item, depth + 1);
            if (prompt) return prompt;
        }
        return '';
    }

    if (typeof input === 'object') {
        const confirmKeys = ['confirmation', 'decision', 'answer', 'response', 'value'];
        for (const key of confirmKeys) {
            if (Object.prototype.hasOwnProperty.call(input, key)) {
                const prompt = extractPromptInput(input[key], depth + 1);
                if (prompt) return prompt;
            }
        }

        const actionPrompt = normalizeActionPrompt(
            input.action ?? input.operation ?? input.intent ?? input.command,
        );
        if (actionPrompt) return actionPrompt;

        const textKeys = ['promptText', 'prompt', 'input', 'message', 'text', 'rawInput'];
        for (const key of textKeys) {
            if (Object.prototype.hasOwnProperty.call(input, key)) {
                const prompt = extractPromptInput(input[key], depth + 1);
                if (prompt) return prompt;
            }
        }
    }

    return '';
}

function getCrudOperationVerb(operation = '') {
    const normalized = String(operation || '').trim().toUpperCase();
    switch (normalized) {
        case 'CREATE':
            return 'create';
        case 'UPDATE':
            return 'update';
        case 'DELETE':
            return 'delete';
        case 'SELECT':
            return 'retrieve';
        default:
            return 'complete';
    }
}

function buildCrudFailureMessage(operation, entityName, error) {
    const verb = getCrudOperationVerb(operation);
    const target = String(entityName || 'record');
    const details = String(error?.message || error || '')
        .replace(/^error:\s*/i, '')
        .replace(/\s+/g, ' ')
        .trim();

    if (!details) {
        return `Cannot ${verb} ${target} right now due to an unexpected error.`;
    }

    if (/(timed out|timeout)/i.test(details)) {
        return `Cannot ${verb} ${target} right now because the request timed out. Please try again.`;
    }

    if (/(dbadapter not available|database service is not available|service unavailable|cannot access database|failed to read .* records|failed to query|cannot retrieve)/i.test(details)) {
        return `Cannot ${verb} ${target} right now because the database service is unavailable. Details: ${details}`;
    }

    if (/(already exists|duplicate|unique constraint|must be unique|uniqueness|duplicate key|conflict)/i.test(details)) {
        return `Cannot ${verb} ${target} because a record with the same unique value already exists. Details: ${details}`;
    }

    if (/(foreign key|constraint|referenc|dependent|violat)/i.test(details)) {
        return `Cannot ${verb} ${target} because related records depend on it. Details: ${details}`;
    }

    if (/^(cannot|failed to|unable to)\b/i.test(details)) {
        return details;
    }

    return `Cannot ${verb} ${target}. Details: ${details}`;
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

    isDeleteGuardEnabled(parsedSkill) {
        const mode = String(parsedSkill?.deleteGuard?.mode || '').trim().toLowerCase();
        return mode === 'block_if_referenced';
    }

    extractDependencyTableFromRelationType(typeValue) {
        const typeText = String(typeValue || '').trim();
        if (!typeText) return null;
        const match = typeText.match(/\bwith\s+([a-zA-Z_][\w]*)\b/i);
        return match ? match[1] : null;
    }

    extractDependentReferencesFromRelationships(parsedSkill) {
        const currentTable = normalizeIdentifier(parsedSkill?.tableName);
        if (!currentTable) return [];

        const primaryKey = normalizeIdentifier(
            parsedSkill?.primaryKey || `${parsedSkill?.tableName || ''}_id`,
        );
        const dependencies = [];
        const relationships = Array.isArray(parsedSkill?.relationships)
            ? parsedSkill.relationships
            : [];

        for (const relation of relationships) {
            if (!relation || typeof relation !== 'object') continue;

            const sourceTable = String(relation.sourceTable || '').trim();
            const sourceField = String(relation.sourceField || '').trim();
            const targetTable = normalizeIdentifier(relation.targetTable);
            const targetField = normalizeIdentifier(relation.targetField);

            if (
                sourceTable
                && sourceField
                && targetTable === currentTable
                && (!primaryKey || !targetField || targetField === primaryKey)
            ) {
                dependencies.push({ tableName: sourceTable, foreignKey: sourceField });
                continue;
            }

            if (relation.referencedBy) {
                const pair = parseTableFieldRef(relation.referencedBy);
                if (pair) {
                    dependencies.push({ tableName: pair.table, foreignKey: pair.field });
                    continue;
                }
            }

            if (relation.field) {
                const refs = parseFieldReferenceExpression(relation.field);
                if (
                    refs
                    && normalizeIdentifier(refs.target.table) === currentTable
                    && (!primaryKey || normalizeIdentifier(refs.target.field) === primaryKey)
                ) {
                    dependencies.push({
                        tableName: refs.source.table,
                        foreignKey: refs.source.field,
                    });
                    continue;
                }
            }

            if (relation.reference) {
                const referencePair = parseTableFieldRef(relation.reference);
                if (
                    referencePair
                    && normalizeIdentifier(referencePair.table) === currentTable
                    && (!primaryKey || normalizeIdentifier(referencePair.field) === primaryKey)
                ) {
                    let dependentTable = String(relation.sourceTable || '').trim();
                    let foreignKey = String(relation.sourceField || '').trim();

                    if (!dependentTable || !foreignKey) {
                        const foreignPair = parseTableFieldRef(relation.foreign);
                        if (foreignPair) {
                            dependentTable = foreignPair.table;
                            foreignKey = foreignPair.field;
                        } else {
                            foreignKey = String(relation.foreign || '').trim();
                            dependentTable = dependentTable || this.extractDependencyTableFromRelationType(relation.type);
                        }
                    }

                    if (dependentTable && foreignKey) {
                        dependencies.push({
                            tableName: dependentTable,
                            foreignKey,
                        });
                    }
                }
            }
        }

        return dedupeDependencies(dependencies);
    }

    async resolveDeleteDependencies(parsedSkill) {
        return this.extractDependentReferencesFromRelationships(parsedSkill);
    }

    async countReferenceRecords(tableName, foreignKey, recordId) {
        if (!this.dbAdapter || typeof this.dbAdapter.query !== 'function') {
            return 0;
        }
        try {
            const records = await this.dbAdapter.query(
                tableName,
                { [foreignKey]: recordId },
                { limit: 1000 },
            );
            return Array.isArray(records) ? records.length : 0;
        } catch (error) {
            debugWarn(
                `[DBTableSkills] Failed dependency lookup for ${tableName}.${foreignKey}:`,
                error?.message || String(error),
            );
            return 0;
        }
    }

    async assertDeleteAllowed(parsedSkill, recordId) {
        if (!this.isDeleteGuardEnabled(parsedSkill)) return;
        if (!this.dbAdapter || typeof this.dbAdapter.query !== 'function') return;

        const tableName = String(parsedSkill?.tableName || '').trim();
        const normalizedId = recordId === null || recordId === undefined
            ? ''
            : String(recordId).trim();
        if (!tableName || !normalizedId) return;

        const dependencies = await this.resolveDeleteDependencies(parsedSkill);
        if (!dependencies.length) return;
        const blockers = [];

        for (const dependency of dependencies) {
            const count = await this.countReferenceRecords(
                dependency.tableName,
                dependency.foreignKey,
                normalizedId,
            );
            if (count > 0) {
                blockers.push(`${dependency.tableName}.${dependency.foreignKey} (${count})`);
            }
        }

        if (blockers.length > 0) {
            throw new Error(
                `Cannot delete ${tableName} '${normalizedId}' because it is referenced by dependent records: ${blockers.join(', ')}`,
            );
        }
    }

    normalizeDeleteValidationResult(result, recordId, primaryKey = 'id') {
        const fallbackField = String(primaryKey || 'id');
        const fallbackValue = recordId;

        if (result === null || result === undefined) {
            return { isValid: true, errors: [] };
        }

        if (typeof result === 'boolean') {
            return result
                ? { isValid: true, errors: [] }
                : {
                    isValid: false,
                    errors: [{ field: fallbackField, error: 'Delete validation failed.', value: fallbackValue }],
                };
        }

        if (Array.isArray(result)) {
            const errors = result.map((errorEntry) => {
                if (errorEntry && typeof errorEntry === 'object') return errorEntry;
                return { field: fallbackField, error: String(errorEntry), value: fallbackValue };
            });
            return { isValid: errors.length === 0, errors };
        }

        if (typeof result === 'object') {
            const maybeErrors = Array.isArray(result.errors) ? result.errors : [];
            const normalizedErrors = maybeErrors.map((errorEntry) => {
                if (errorEntry && typeof errorEntry === 'object') return errorEntry;
                return { field: fallbackField, error: String(errorEntry), value: fallbackValue };
            });
            const isValid = typeof result.isValid === 'boolean'
                ? result.isValid
                : normalizedErrors.length === 0;
            return { isValid, errors: normalizedErrors };
        }

        return {
            isValid: false,
            errors: [{ field: fallbackField, error: String(result), value: fallbackValue }],
        };
    }

    attachDeleteValidator(execContext) {
        if (!execContext || typeof execContext !== 'object') return execContext;
        if (execContext.__deleteValidatorWrapped) return execContext;

        const rawValidateDelete = typeof execContext.validateDelete === 'function'
            ? execContext.validateDelete
            : null;

        execContext.validateDelete = async (recordId, record, context = {}) => {
            const primaryKey = context?.primaryKey || 'id';
            const mergedContext = {
                ...(context || {}),
                selectRecords: typeof context?.selectRecords === 'function'
                    ? context.selectRecords
                    : execContext.selectRecords,
            };

            if (rawValidateDelete) {
                try {
                    const result = await rawValidateDelete.call(execContext, recordId, record, mergedContext);
                    return this.normalizeDeleteValidationResult(result, recordId, primaryKey);
                } catch (error) {
                    return this.normalizeDeleteValidationResult({
                        isValid: false,
                        errors: [{
                            field: primaryKey,
                            error: error?.message || String(error),
                            value: recordId,
                        }],
                    }, recordId, primaryKey);
                }
            }

            const guardMode = String(mergedContext?.deleteGuard?.mode || '').toLowerCase();
            if (guardMode === 'block_if_referenced' && typeof mergedContext.checkDeleteReferences === 'function') {
                const message = await mergedContext.checkDeleteReferences(recordId, record);
                if (message) {
                    return {
                        isValid: false,
                        errors: [{
                            field: primaryKey,
                            error: String(message),
                            value: recordId,
                        }],
                    };
                }
            }

            return { isValid: true, errors: [] };
        };

        execContext.__deleteValidatorWrapped = true;
        return execContext;
    }

    buildDeleteValidationContext(parsedSkill, primaryKey, execContext) {
        return {
            primaryKey,
            tableName: parsedSkill?.tableName || '',
            deleteGuard: parsedSkill?.deleteGuard || null,
            relationships: parsedSkill?.relationships || [],
            checkDeleteReferences: async (recordId, _record) => {
                try {
                    await this.assertDeleteAllowed(parsedSkill, recordId);
                    return '';
                } catch (error) {
                    return error?.message || String(error);
                }
            },
            selectRecords: typeof execContext?.selectRecords === 'function'
                ? execContext.selectRecords.bind(execContext)
                : null,
        };
    }

    async runDeleteValidation(execContext, parsedSkill, recordId, record) {
        const primaryKey = parsedSkill?.primaryKey || `${parsedSkill?.tableName || 'record'}_id`;
        const validationContext = this.buildDeleteValidationContext(parsedSkill, primaryKey, execContext);

        const validator = typeof execContext?.validateDelete === 'function'
            ? execContext.validateDelete
            : null;

        if (!validator) {
            await this.assertDeleteAllowed(parsedSkill, recordId);
            return;
        }

        const validation = await validator.call(execContext, recordId, record, validationContext);
        const normalized = this.normalizeDeleteValidationResult(validation, recordId, primaryKey);

        if (!normalized.isValid) {
            const firstError = normalized.errors[0];
            if (firstError && typeof firstError.error === 'string' && firstError.error.trim()) {
                throw new Error(firstError.error);
            }
            throw new Error(`Delete validation failed for ${parsedSkill?.tableName || 'record'} ${recordId}`);
        }
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
        const generatedPath = tskillPath ? path.join(path.dirname(tskillPath), 'src', 'tskill.generated.mjs') : null;

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
                    throw new Error(`Cannot retrieve ${tableName} records because the database service is unavailable.`);
                }
                try {
                    const records = await dbAdapter.query(tableName, filter);
                    return Array.isArray(records) ? records : [];
                } catch (error) {
                    const details = error?.message || String(error);
                    throw new Error(`Failed to read ${tableName} records: ${details}`);
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

            return this.attachDeleteValidator(enhanced);
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
        throw new Error('Cannot retrieve ' + tableName + ' records because the database service is unavailable.');
    }
    try {
        const records = await dbAdapter.query(tableName, filter);
        return Array.isArray(records) ? records : [];
    } catch (error) {
        const details = error && error.message ? error.message : String(error);
        throw new Error('Failed to read ' + tableName + ' records: ' + details);
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

${functions.global.validateDelete || ''}

${functions.global.presentRecord || ''}

${functions.global.generatePKValues || ''}

// Return object with global functions
return {
    generatePKValues: typeof generatePKValues !== 'undefined' ? generatePKValues : null,
    prepareRecord: typeof prepareRecord !== 'undefined' ? prepareRecord : null,
    validateRecord: typeof validateRecord !== 'undefined' ? validateRecord : null,
    validateDelete: typeof validateDelete !== 'undefined' ? validateDelete : null,
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
            return this.attachDeleteValidator(eval(contextCode));
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
        // Generate primary key only if caller did not provide one
        if (execContext.generatePKValues) {
            const primaryKeyField = parsedSkill.primaryKey || parsedSkill.primaryKeyField || 'id';
            const hasPrimaryKey = Boolean(
                newRecord[primaryKeyField] !== undefined &&
                newRecord[primaryKeyField] !== null &&
                newRecord[primaryKeyField] !== ''
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
            const message = buildCrudFailureMessage('CREATE', parsedSkill.tableName || 'record', error);
            return {
                success: false,
                operation: 'CREATE',
                message,
                error: message,
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
            const message = buildCrudFailureMessage('UPDATE', parsedSkill.tableName || 'record', error);
            return {
                success: false,
                operation: 'UPDATE',
                message,
                error: message,
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

                await this.runDeleteValidation(execContext, parsedSkill, recordId, record);
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
            const message = buildCrudFailureMessage('DELETE', parsedSkill.tableName || 'record', error);
            return {
                success: false,
                operation: 'DELETE',
                message,
                error: message,
            };
        }
    }

    /**
     * Execute a skill prompt
     */
    async executeSkillPrompt({ skillRecord, promptText, options = {} }) {
        const {
            args = {},
        } = options;
        const sessionMemory = options.sessionMemory
            || options.context?.sessionMemory
            || null;

        let executor = this.executors.get(skillRecord.name);
        if (!executor) {
            try {
                // Lazy self-heal: if executor cache was lost/reset, prepare on demand.
                await this.prepareSkill(skillRecord);
                executor = this.executors.get(skillRecord.name);
            } catch (error) {
                const details = error?.message || String(error);
                return {
                    skill: skillRecord.name,
                    metadata: skillRecord.metadata || null,
                    result: {
                        success: false,
                        operation: 'SYSTEM',
                        message: `Cannot run ${skillRecord.name} because skill initialization failed. Details: ${details}`,
                    },
                    sessionMemory,
                };
            }
        }

        if (!executor) {
            return {
                skill: skillRecord.name,
                metadata: skillRecord.metadata || null,
                result: {
                    success: false,
                    operation: 'SYSTEM',
                    message: `Cannot run ${skillRecord.name} because its executor is unavailable.`,
                },
                sessionMemory,
            };
        }

        const promptSource = typeof args[DB_TABLE_ARGUMENT_NAME] === 'string' && args[DB_TABLE_ARGUMENT_NAME].trim()
            ? args[DB_TABLE_ARGUMENT_NAME]
            : (args[DB_TABLE_ARGUMENT_NAME] ?? promptText);
        const prompt = extractPromptInput(promptSource);

        if (!prompt) {
            return {
                skill: skillRecord.name,
                metadata: skillRecord.metadata || null,
                result: {
                    success: false,
                    operation: 'SYSTEM',
                    message: `Cannot run ${skillRecord.name} because the prompt is empty.`,
                },
                sessionMemory,
            };
        }

        let result;
        try {
            result = await executor({ prompt }, { sessionMemory });
        } catch (error) {
            const details = error?.message || String(error);
            result = {
                success: false,
                operation: 'SYSTEM',
                message: `Cannot execute ${skillRecord.name}. Details: ${details}`,
            };
        }

        return {
            skill: skillRecord.name,
            metadata: skillRecord.metadata || null,
            result,
            sessionMemory,
        };
    }
}
