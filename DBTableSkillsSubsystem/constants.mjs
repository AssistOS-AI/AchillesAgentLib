/**
 * Constants for DBTableSkillsSubsystem and ConversationalTskillController
 */

/**
 * CRUD operation types recognized by the tskill controller.
 */
export const CRUD_OPERATIONS = {
    CREATE: 'CREATE',
    SELECT: 'SELECT',
    UPDATE: 'UPDATE',
    DELETE: 'DELETE',
};

/**
 * Pending state key suffixes used in sessionMemory.
 * Combined with entity name: `pending_${entity}_${suffix}`
 */
export const PENDING_STATE_SUFFIXES = {
    CREATE: 'create',
    UPDATE: 'update',
    DELETE: 'delete',
    VALIDATION: 'validation',
    UPDATE_CAPTURE: 'update_capture',
};

/**
 * Build a pending state key for sessionMemory.
 * @param {string} entity - Entity/table name
 * @param {string} suffix - One of PENDING_STATE_SUFFIXES
 * @returns {string} Key like 'pending_equipment_create'
 */
export const pendingKey = (entity, suffix) => `pending_${entity}_${suffix}`;

/**
 * Fields automatically hidden from table display.
 * These are typically audit/metadata fields.
 */
export const HIDDEN_AUDIT_FIELDS = [
    'created_at',
    'updated_at',
    'deleted_at',
    'created_by',
    'updated_by',
];

/**
 * Default placeholder for null/undefined values in table display.
 */
export const NULL_DISPLAY_VALUE = '—';

/**
 * Timeout for DBTable skill operations in milliseconds.
 * Can be overridden via ACHILLES_DBTABLE_TIMEOUT env var.
 */
export const DEFAULT_DBTABLE_TIMEOUT_MS = 60000;
