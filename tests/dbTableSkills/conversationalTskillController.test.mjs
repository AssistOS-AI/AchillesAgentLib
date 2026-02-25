/**
 * Unit Tests for ConversationalTskillController
 *
 * Tests the multi-turn conversation flows used by DBTableSkillsSubsystem
 * for tskills. Uses stub subsystem, LLM, and execution context to verify
 * flow logic without external dependencies.
 */

import test from 'node:test';
import assert from 'node:assert';
import { ConversationalTskillController } from '../../DBTableSkillsSubsystem/ConversationalTskillController.mjs';

// ============= Test Helpers =============

/** In-memory record store used by the mock execution context. */
class RecordStore {
    constructor(records = []) {
        this.records = [...records];
        this.insertCalls = [];
        this.updateCalls = [];
        this.deleteCalls = [];
    }
}

/** Builds a minimal mock execution context that ConversationalTskillController expects. */
function buildExecContext(store) {
    return {
        selectRecords: async (filter) => {
            if (!filter || Object.keys(filter).length === 0) return store.records;
            return store.records.filter(r => {
                return Object.entries(filter).every(([k, v]) => r[k] === v);
            });
        },
        insertRecord: async (record) => {
            store.insertCalls.push(record);
            return { ...record };
        },
        updateRecord: async (id, data) => {
            store.updateCalls.push({ id, data });
            return { ...data };
        },
        deleteRecord: async (id) => {
            store.deleteCalls.push(id);
        },
        generatePKValues: () => ({ equipment_id: 'EQP_AUTO_001' }),
        prepareRecord: async (record) => ({ ...record }),
        validateRecord: async (record) => ({ isValid: true, errors: [] }),
        presentRecord: async (record) => ({ ...record }),
    };
}

/** Builds a minimal mock subsystem. */
function buildMockSubsystem(store) {
    const ctx = buildExecContext(store);
    return {
        createExecutionContext: () => ctx,
        _execContext: ctx,
    };
}

/** Builds a mock LLM that returns a fixed operation response. */
function buildMockLLM(response) {
    return {
        executePrompt: async () => response,
        resolveConfirmation: async () => ({ decision: 'unclear' }),
    };
}

/** A standard parsed skill definition for testing. */
const TEST_SKILL = {
    tableName: 'equipment',
    tablePurpose: 'Equipment tracking',
    primaryKey: 'equipment_id',
    interactiveFields: ['equipment_id', 'name', 'status'],
    listExtraFields: [],
    fields: {
        equipment_id: { description: 'Unique ID' },
        name: { description: 'Equipment name' },
        status: { description: 'Current status' },
    },
};

/** Helper to create a ConversationalTskillController with defaults. */
function createTemplate(overrides = {}) {
    const store = overrides.store || new RecordStore();
    const subsystem = overrides.subsystem || buildMockSubsystem(store);
    const parsedSkill = overrides.parsedSkill || TEST_SKILL;
    const llmAgent = overrides.llmAgent || buildMockLLM({
        operation: 'SELECT',
        filter: {},
        data: {},
    });

    const template = new ConversationalTskillController(subsystem, parsedSkill, {}, llmAgent);
    return { template, store, subsystem };
}

// ============= Constructor =============

test('ConversationalTskillController constructor sets properties correctly', () => {
    const { template } = createTemplate();

    assert.strictEqual(template.entityName, 'equipment');
    assert.strictEqual(template.primaryKey, 'equipment_id');
    assert.ok(template.fields.equipment_id);
    assert.ok(template.fields.name);
});

test('ConversationalTskillController uses tableName_id as default primary key', () => {
    const skill = { ...TEST_SKILL, primaryKey: undefined };
    const store = new RecordStore();
    const template = new ConversationalTskillController(
        buildMockSubsystem(store), skill, {}, buildMockLLM({}),
    );
    assert.strictEqual(template.primaryKey, 'equipment_id');
});

test('create/update field tables use short field names and descriptive guidance', () => {
    const parsedSkill = {
        ...TEST_SKILL,
        fields: {
            equipment_id: {
                description: 'Unique identifier for the equipment item. String type, primary key.',
                isRequired: true,
            },
            name: {
                description: 'Display name for the equipment (e.g., "Makita SDS Drill")',
                isRequired: true,
            },
            status: {
                description: 'Current operational status of the equipment',
                isRequired: true,
            },
        },
    };

    const { template } = createTemplate({ parsedSkill });
    const createTable = template.formatCreateRequiredFieldsTable(['equipment_id', 'name'], {});
    assert.ok(createTable.includes('| equipment_id | **Required**: Unique identifier for the equipment item. String type, primary key. |'));
    assert.ok(createTable.includes('| name | **Required**: Display name for the equipment (e.g., "Makita SDS Drill") |'));
    assert.ok(!createTable.includes('| Unique identifier for the equipment item. String type, primary key. | Unique identifier for the equipment item. String type, primary key. |'));

    const updateTable = template.buildEditableUpdateFieldsTable();
    assert.ok(updateTable.includes('| name | **Required**: Display name for the equipment (e.g., "Makita SDS Drill") |'));
    assert.ok(updateTable.includes('| status | **Required**: Current operational status of the equipment |'));
});


test('create/update field tables prefer tskill display labels when provided', () => {
    const parsedSkill = {
        ...TEST_SKILL,
        fields: {
            equipment_id: {
                description: 'Unique identifier for the equipment item. String type, primary key.',
                label: 'Equipment ID',
                isRequired: true,
            },
            name: {
                description: 'Display name for the equipment (e.g., "Makita SDS Drill")',
                shortLabel: 'Equipment Name',
                isRequired: true,
            },
            status: {
                description: 'Current operational status of the equipment',
                isRequired: true,
            },
        },
    };

    const { template } = createTemplate({ parsedSkill });
    const createTable = template.formatCreateRequiredFieldsTable(['equipment_id', 'name'], {});
    assert.ok(createTable.includes('| Equipment ID | **Required**: Unique identifier for the equipment item. String type, primary key. |'));
    assert.ok(createTable.includes('| Equipment Name | **Required**: Display name for the equipment (e.g., "Makita SDS Drill") |'));

    const prompt = template.buildPrimaryKeyPrompt('delete', [{ equipment_id: 'EQ-1', name: 'Drill' }]);
    assert.ok(prompt.includes('Please provide the Equipment ID'));
});

test('update guidance marks non-required fields as optional', () => {
    const parsedSkill = {
        ...TEST_SKILL,
        fields: {
            equipment_id: {
                description: 'Unique identifier for the equipment item. String type, primary key.',
                isRequired: true,
            },
            name: {
                description: 'Display name for the equipment (e.g., "Makita SDS Drill")',
                isRequired: true,
            },
            status: {
                description: 'Current operational status of the equipment',
                isRequired: false,
            },
        },
    };

    const { template } = createTemplate({ parsedSkill });
    const updateTable = template.buildEditableUpdateFieldsTable();
    assert.ok(updateTable.includes('| status | Optional: Current operational status of the equipment |'));
});

test('create capture message shows all fields and omits required-fields heading', () => {
    const parsedSkill = {
        ...TEST_SKILL,
        fields: {
            equipment_id: {
                description: 'Unique identifier for the equipment item. String type, primary key.',
                isRequired: true,
            },
            name: {
                description: 'Display name for the equipment (e.g., "Makita SDS Drill")',
                isRequired: true,
            },
            status: {
                description: 'Current operational status of the equipment',
                isRequired: false,
            },
        },
    };

    const { template } = createTemplate({ parsedSkill });
    const message = template.buildCreateCaptureMessage({
        requiredFields: ['equipment_id', 'name'],
        record: {},
    });

    assert.ok(message.includes('To create this equipment, provide values for all required fields.'));
    assert.ok(!message.includes('Required fields status:'));
    assert.ok(message.includes('| equipment_id | **Required**: Unique identifier for the equipment item. String type, primary key. | Missing | — |'));
    assert.ok(message.includes('| status | Optional: Current operational status of the equipment | Optional | — |'));
});

// ============= execute: SELECT flow =============

test('execute routes SELECT and returns records', async () => {
    const store = new RecordStore([
        { equipment_id: 'E1', name: 'Drill', status: 'Active', id: 'EQUIPME.1' },
        { equipment_id: 'E2', name: 'Saw', status: 'Active', id: 'EQUIPME.2' },
    ]);
    const llm = buildMockLLM({ operation: 'SELECT', filter: {}, data: {} });
    const { template } = createTemplate({ store, llmAgent: llm });
    const memory = new Map();

    const result = await template.execute('list equipment', { sessionMemory: memory });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.operation, 'SELECT');
    assert.strictEqual(result.count, 2);
    assert.strictEqual(result.records.length, 2);
    assert.strictEqual(result.records[0].id, undefined);
    assert.strictEqual(result.records[1].id, undefined);
});

test('execute SELECT returns empty set gracefully', async () => {
    const store = new RecordStore([]);
    const llm = buildMockLLM({ operation: 'SELECT', filter: {}, data: {} });
    const { template } = createTemplate({ store, llmAgent: llm });
    const memory = new Map();

    const result = await template.execute('list equipment', { sessionMemory: memory });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.operation, 'SELECT');
    assert.strictEqual(result.count, 0);
    assert.ok(result.message.includes('No equipment'));
});

test('execute SELECT returns full large result sets by default', async () => {
    const store = new RecordStore(
        Array.from({ length: 25 }, (_, idx) => ({
            equipment_id: `E${String(idx + 1).padStart(2, '0')}`,
            name: `Tool ${idx + 1}`,
            status: 'Active',
        })),
    );
    const llm = buildMockLLM({ operation: 'SELECT', filter: {}, data: {} });
    const { template } = createTemplate({ store, llmAgent: llm });
    const memory = new Map();

    const result = await template.execute('list equipment', { sessionMemory: memory });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.operation, 'SELECT');
    assert.strictEqual(result.count, 25);
    assert.strictEqual(result.totalCount, 25);
    assert.strictEqual(result.records.length, 25);
    assert.strictEqual(result.requiresInput, false);
    assert.strictEqual(result.pagination?.hasNext, false);
    assert.ok(result.message.includes('Showing all 25 equipment(s).'));
    assert.strictEqual(memory.has('pending_equipment_select_pagination'), false);
});

test('execute SELECT with prompt "next" still returns full list (no pagination state)', async () => {
    const store = new RecordStore(
        Array.from({ length: 45 }, (_, idx) => ({
            equipment_id: `E${String(idx + 1).padStart(3, '0')}`,
            name: `Tool ${idx + 1}`,
            status: 'Active',
        })),
    );
    const llm = buildMockLLM({ operation: 'SELECT', filter: {}, data: {} });
    const { template } = createTemplate({ store, llmAgent: llm });
    const memory = new Map();

    const second = await template.execute('next', { sessionMemory: memory });
    assert.strictEqual(second.success, true);
    assert.strictEqual(second.count, 45);
    assert.strictEqual(second.requiresInput, false);
    assert.strictEqual(second.pagination?.hasNext, false);
    assert.ok(second.message.includes('Showing all 45 equipment(s).'));
    assert.strictEqual(memory.has('pending_equipment_select_pagination'), false);
});

test('execute SELECT supports explicit show all command', async () => {
    const store = new RecordStore(
        Array.from({ length: 45 }, (_, idx) => ({
            equipment_id: `E${String(idx + 1).padStart(3, '0')}`,
            name: `Tool ${idx + 1}`,
            status: 'Active',
        })),
    );
    const llm = buildMockLLM({ operation: 'SELECT', filter: {}, data: {} });
    const { template } = createTemplate({ store, llmAgent: llm });
    const memory = new Map();

    const all = await template.execute('show all', { sessionMemory: memory });

    assert.strictEqual(all.success, true);
    assert.strictEqual(all.operation, 'SELECT');
    assert.strictEqual(all.count, 45);
    assert.strictEqual(all.totalCount, 45);
    assert.strictEqual(all.requiresInput, false);
    assert.strictEqual(all.pagination?.hasNext, false);
    assert.ok(all.message.includes('Showing all 45 equipment(s).'));
    assert.strictEqual(memory.has('pending_equipment_select_pagination'), false);
});

test('execute SELECT supports first N window', async () => {
    const store = new RecordStore(
        Array.from({ length: 10 }, (_, idx) => ({
            equipment_id: `E${String(idx + 1).padStart(2, '0')}`,
            name: `Tool ${idx + 1}`,
            status: 'Active',
        })),
    );
    const llm = buildMockLLM({ operation: 'SELECT', filter: {}, data: {} });
    const { template } = createTemplate({ store, llmAgent: llm });
    const memory = new Map();

    const result = await template.execute('list first 4 equipment', { sessionMemory: memory });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.operation, 'SELECT');
    assert.strictEqual(result.count, 4);
    assert.strictEqual(result.totalCount, 10);
    assert.strictEqual(result.records[0].equipment_id, 'E01');
    assert.strictEqual(result.records[3].equipment_id, 'E04');
    assert.ok(result.message.includes('Showing first 4 equipment(s).'));
});

test('execute SELECT supports last N window', async () => {
    const store = new RecordStore(
        Array.from({ length: 10 }, (_, idx) => ({
            equipment_id: `E${String(idx + 1).padStart(2, '0')}`,
            name: `Tool ${idx + 1}`,
            status: 'Active',
        })),
    );
    const llm = buildMockLLM({ operation: 'SELECT', filter: {}, data: {} });
    const { template } = createTemplate({ store, llmAgent: llm });
    const memory = new Map();

    const result = await template.execute('list last 3 equipment', { sessionMemory: memory });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.operation, 'SELECT');
    assert.strictEqual(result.count, 3);
    assert.strictEqual(result.totalCount, 10);
    assert.strictEqual(result.records[0].equipment_id, 'E08');
    assert.strictEqual(result.records[2].equipment_id, 'E10');
    assert.ok(result.message.includes('Showing last 3 equipment(s).'));
});

test('execute SELECT supports text filters with contains syntax', async () => {
    const store = new RecordStore([
        { equipment_id: 'E1', name: 'Drill Alpha', status: 'Active' },
        { equipment_id: 'E2', name: 'Saw', status: 'Active' },
        { equipment_id: 'E3', name: 'DRILL Beta', status: 'Active' },
    ]);
    const llm = buildMockLLM({ operation: 'SELECT', filter: {}, data: {} });
    const { template } = createTemplate({ store, llmAgent: llm });
    const memory = new Map();

    const result = await template.execute('list equipment where name contains drill', { sessionMemory: memory });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.operation, 'SELECT');
    assert.strictEqual(result.count, 2);
    assert.strictEqual(result.totalCount, 2);
    assert.deepStrictEqual(
        result.records.map(r => r.equipment_id),
        ['E1', 'E3'],
    );
});

// ============= execute: CREATE flow =============

test('execute CREATE stores pending state and requires confirmation', async () => {
    const store = new RecordStore();
    const llm = buildMockLLM({
        operation: 'CREATE',
        data: { name: 'New Drill', status: 'Active' },
    });
    const { template } = createTemplate({ store, llmAgent: llm });
    const memory = new Map();

    const result = await template.execute('add drill', { sessionMemory: memory });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.operation, 'CREATE');
    assert.strictEqual(result.requiresConfirmation, true);
    assert.ok(result.message.includes('yes'));
    assert.ok(result.message.includes('no'));

    // Pending state should be stored
    const pending = memory.get('pending_equipment_create');
    assert.ok(pending, 'Pending create state should exist');
    assert.ok(pending.record, 'Pending should have record');
});

test('CREATE confirmation: yes executes insert', async () => {
    const store = new RecordStore();
    const { template } = createTemplate({ store });
    const memory = new Map();

    // Pre-set pending state
    memory.set('pending_equipment_create', {
        record: { equipment_id: 'E1', name: 'Drill', status: 'Active' },
    });

    const result = await template.execute('yes', { sessionMemory: memory });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.operation, 'CREATE');
    assert.ok(result.message.includes('created successfully'));
    assert.strictEqual(store.insertCalls.length, 1);
    assert.strictEqual(memory.has('pending_equipment_create'), false);
});

test('CREATE confirmation: no cancels', async () => {
    const store = new RecordStore();
    const { template } = createTemplate({ store });
    const memory = new Map();

    memory.set('pending_equipment_create', {
        record: { equipment_id: 'E1', name: 'Drill' },
    });

    const result = await template.execute('no', { sessionMemory: memory });

    assert.strictEqual(result.operation, 'CREATE');
    assert.strictEqual(result.cancelled, true);
    assert.ok(result.message.includes('cancelled'));
    assert.strictEqual(store.insertCalls.length, 0);
    assert.strictEqual(memory.has('pending_equipment_create'), false);
});

test('CREATE confirmation: unclear asks again', async () => {
    const store = new RecordStore();
    const { template } = createTemplate({ store });
    const memory = new Map();

    memory.set('pending_equipment_create', {
        record: { equipment_id: 'E1', name: 'Drill' },
    });

    const result = await template.execute('maybe', { sessionMemory: memory });

    assert.strictEqual(result.operation, 'CREATE');
    assert.ok(result.message.includes('yes'));
    // Pending state preserved
    assert.strictEqual(memory.has('pending_equipment_create'), true);
    assert.strictEqual(store.insertCalls.length, 0);
});

// ============= execute: CREATE with validation errors =============

test('CREATE with validation errors stores pending validation', async () => {
    const store = new RecordStore();
    const subsystem = buildMockSubsystem(store);
    // Override validateRecord to fail
    subsystem._execContext.validateRecord = async () => ({
        isValid: false,
        errors: [{ field: 'name', error: 'Name is required' }],
    });

    const llm = buildMockLLM({
        operation: 'CREATE',
        data: { status: 'Active' },
    });
    const template = new ConversationalTskillController(subsystem, TEST_SKILL, {}, llm);
    const memory = new Map();

    const result = await template.execute('add drill', { sessionMemory: memory });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.operation, 'CREATE');
    assert.ok(result.message.includes('Validation errors'));
    assert.ok(result.message.includes('Name is required'));

    const pendingValidation = memory.get('pending_equipment_validation');
    assert.ok(pendingValidation, 'Pending validation should be stored');
    assert.strictEqual(pendingValidation.operation, 'CREATE');
});

// ============= execute: DELETE flow =============

test('execute DELETE stores pending and requires confirmation', async () => {
    const store = new RecordStore([
        { equipment_id: 'E1', name: 'Drill' },
    ]);
    const llm = buildMockLLM({
        operation: 'DELETE',
        filter: { equipment_id: 'E1' },
    });
    const { template } = createTemplate({ store, llmAgent: llm });
    const memory = new Map();

    const result = await template.execute('delete E1', { sessionMemory: memory });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.operation, 'DELETE');
    assert.strictEqual(result.requiresConfirmation, true);
    assert.ok(memory.has('pending_equipment_delete'));
});

test('execute DELETE without primary key requests ID capture', async () => {
    const store = new RecordStore([
        { equipment_id: 'E1', name: 'Drill' },
        { equipment_id: 'E2', name: 'Saw' },
    ]);
    const llm = buildMockLLM({
        operation: 'DELETE',
        filter: {},
    });
    const { template } = createTemplate({ store, llmAgent: llm });
    const memory = new Map();

    const result = await template.execute('delete equipment', { sessionMemory: memory });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.operation, 'DELETE');
    assert.strictEqual(result.requiresInput, true);
    assert.ok(result.message.includes('Please provide the equipment_id'));
    assert.ok(result.message.includes('E1'));
    assert.ok(memory.has('pending_equipment_delete_capture'));
});

test('DELETE id capture resolves to single-record confirmation', async () => {
    const store = new RecordStore([
        { equipment_id: 'E1', name: 'Drill' },
        { equipment_id: 'E2', name: 'Saw' },
    ]);
    const llm = buildMockLLM({
        operation: 'DELETE',
        filter: {},
    });
    const { template } = createTemplate({ store, llmAgent: llm });
    const memory = new Map();

    await template.execute('delete equipment', { sessionMemory: memory });
    const result = await template.execute('E2', { sessionMemory: memory });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.operation, 'DELETE');
    assert.strictEqual(result.requiresConfirmation, true);
    assert.ok(memory.has('pending_equipment_delete'));

    const pendingDelete = memory.get('pending_equipment_delete');
    assert.strictEqual(pendingDelete.records.length, 1);
    assert.strictEqual(pendingDelete.records[0].equipment_id, 'E2');
});

test('DELETE id capture supports next/prev pagination commands', async () => {
    const store = new RecordStore(
        Array.from({ length: 25 }, (_, idx) => ({
            equipment_id: `E${String(idx + 1).padStart(2, '0')}`,
            name: `Tool ${idx + 1}`,
        })),
    );
    const llm = buildMockLLM({
        operation: 'DELETE',
        filter: {},
    });
    const { template } = createTemplate({ store, llmAgent: llm });
    const memory = new Map();

    const first = await template.execute('delete equipment', { sessionMemory: memory });
    assert.strictEqual(first.requiresInput, true);
    assert.ok(first.message.includes('Page 1/2'));

    const second = await template.execute('next', { sessionMemory: memory });
    assert.strictEqual(second.requiresInput, true);
    assert.ok(second.message.includes('Page 2/2'));
    assert.ok(second.message.includes('E21'));
});

test('DELETE with no matching records returns error', async () => {
    const store = new RecordStore([]);
    const llm = buildMockLLM({
        operation: 'DELETE',
        filter: { equipment_id: 'NOEXIST' },
    });
    const { template } = createTemplate({ store, llmAgent: llm });
    const memory = new Map();

    const result = await template.execute('delete NOEXIST', { sessionMemory: memory });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.operation, 'DELETE');
    assert.ok(result.message.includes('No equipment found'));
});

test('DELETE confirmation: yes executes delete', async () => {
    const store = new RecordStore();
    const { template } = createTemplate({ store });
    const memory = new Map();

    memory.set('pending_equipment_delete', {
        records: [{ equipment_id: 'E1', name: 'Drill' }],
    });

    const result = await template.execute('yes', { sessionMemory: memory });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.operation, 'DELETE');
    assert.ok(result.message.includes('Deleted'));
    assert.strictEqual(store.deleteCalls.length, 1);
    assert.strictEqual(store.deleteCalls[0], 'E1');
    assert.strictEqual(memory.has('pending_equipment_delete'), false);
});

test('DELETE confirmation: no cancels', async () => {
    const store = new RecordStore();
    const { template } = createTemplate({ store });
    const memory = new Map();

    memory.set('pending_equipment_delete', {
        records: [{ equipment_id: 'E1' }],
    });

    const result = await template.execute('no', { sessionMemory: memory });

    assert.strictEqual(result.operation, 'DELETE');
    assert.strictEqual(result.cancelled, true);
    assert.strictEqual(store.deleteCalls.length, 0);
});

// ============= execute: UPDATE flow =============

test('execute UPDATE with changes stores pending and requires confirmation', async () => {
    const store = new RecordStore([
        { equipment_id: 'E1', name: 'Old Drill', status: 'Active' },
    ]);
    const llm = buildMockLLM({
        operation: 'UPDATE',
        filter: { equipment_id: 'E1' },
        data: { name: 'New Drill' },
    });
    const { template } = createTemplate({ store, llmAgent: llm });
    const memory = new Map();

    const result = await template.execute('rename E1 to New Drill', { sessionMemory: memory });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.operation, 'UPDATE');
    assert.strictEqual(result.requiresConfirmation, true);
    assert.ok(memory.has('pending_equipment_update'));
});

test('execute UPDATE without primary key requests ID capture', async () => {
    const store = new RecordStore([
        { equipment_id: 'E1', name: 'Old Drill', status: 'Active' },
        { equipment_id: 'E2', name: 'Old Saw', status: 'Active' },
    ]);
    const llm = buildMockLLM({
        operation: 'UPDATE',
        filter: {},
        data: { name: 'Renamed' },
    });
    const { template } = createTemplate({ store, llmAgent: llm });
    const memory = new Map();

    const result = await template.execute('rename equipment', { sessionMemory: memory });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.operation, 'UPDATE');
    assert.strictEqual(result.requiresInput, true);
    assert.ok(result.message.includes('Please provide the equipment_id'));
    assert.ok(memory.has('pending_equipment_update_target_capture'));
});

test('UPDATE id capture resolves to update confirmation', async () => {
    const store = new RecordStore([
        { equipment_id: 'E1', name: 'Old Drill', status: 'Active' },
        { equipment_id: 'E2', name: 'Old Saw', status: 'Active' },
    ]);
    const llm = buildMockLLM({
        operation: 'UPDATE',
        filter: {},
        data: { name: 'Renamed' },
    });
    const { template } = createTemplate({ store, llmAgent: llm });
    const memory = new Map();

    await template.execute('rename equipment', { sessionMemory: memory });
    const result = await template.execute('E2', { sessionMemory: memory });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.operation, 'UPDATE');
    assert.strictEqual(result.requiresConfirmation, true);
    assert.ok(memory.has('pending_equipment_update'));

    const pendingUpdate = memory.get('pending_equipment_update');
    assert.strictEqual(pendingUpdate.id, 'E2');
    assert.strictEqual(pendingUpdate.changes.name, 'Renamed');
});

test('UPDATE id capture supports next/prev pagination commands', async () => {
    const store = new RecordStore(
        Array.from({ length: 25 }, (_, idx) => ({
            equipment_id: `E${String(idx + 1).padStart(2, '0')}`,
            name: `Tool ${idx + 1}`,
            status: 'Active',
        })),
    );
    const llm = buildMockLLM({
        operation: 'UPDATE',
        filter: {},
        data: { name: 'Renamed' },
    });
    const { template } = createTemplate({ store, llmAgent: llm });
    const memory = new Map();

    const first = await template.execute('rename equipment', { sessionMemory: memory });
    assert.strictEqual(first.requiresInput, true);
    assert.ok(first.message.includes('Page 1/2'));

    const second = await template.execute('next', { sessionMemory: memory });
    assert.strictEqual(second.requiresInput, true);
    assert.ok(second.message.includes('Page 2/2'));
    assert.ok(second.message.includes('E21'));
});

test('execute UPDATE with no matching records returns error', async () => {
    const store = new RecordStore([]);
    const llm = buildMockLLM({
        operation: 'UPDATE',
        filter: { equipment_id: 'NOEXIST' },
        data: { name: 'X' },
    });
    const { template } = createTemplate({ store, llmAgent: llm });
    const memory = new Map();

    const result = await template.execute('update NOEXIST', { sessionMemory: memory });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.operation, 'UPDATE');
    assert.ok(result.message.includes('No equipment found'));
});

test('execute UPDATE without data asks what to change', async () => {
    const store = new RecordStore([
        { equipment_id: 'E1', name: 'Drill', status: 'Active' },
    ]);
    const llm = buildMockLLM({
        operation: 'UPDATE',
        filter: { equipment_id: 'E1' },
        data: {},
    });
    const { template } = createTemplate({ store, llmAgent: llm });
    const memory = new Map();

    const result = await template.execute('update E1', { sessionMemory: memory });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.operation, 'UPDATE');
    assert.ok(result.message.includes('What would you like to change'));
    assert.ok(memory.has('pending_equipment_update_capture'));
});

test('UPDATE without data uses short field labels in current-record table', async () => {
    const parsedSkill = {
        ...TEST_SKILL,
        fields: {
            equipment_id: {
                description: 'Unique identifier for the equipment item. String type, primary key.',
                label: 'Equipment ID',
            },
            name: {
                description: 'Display name for the equipment (e.g., "Makita SDS Drill")',
                shortLabel: 'Name',
            },
            status: {
                description: 'Current operational status of the equipment',
            },
        },
    };
    const store = new RecordStore([
        { equipment_id: 'E1', name: 'Drill', status: 'Active' },
    ]);
    const llm = buildMockLLM({
        operation: 'UPDATE',
        filter: { equipment_id: 'E1' },
        data: {},
    });
    const { template } = createTemplate({ store, llmAgent: llm, parsedSkill });
    const memory = new Map();

    const result = await template.execute('update E1', { sessionMemory: memory });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.operation, 'UPDATE');
    assert.ok(result.message.includes('| Field | Current Value | Description |'));
    assert.ok(result.message.includes('| Name | Drill |'));
    assert.ok(!result.message.includes('| Field | Value |'));
    assert.ok(!result.message.includes('Unique identifier for the equipment item. String type, primary key.'));
});

test('UPDATE confirmation: yes executes update', async () => {
    const store = new RecordStore();
    const { template } = createTemplate({ store });
    const memory = new Map();

    memory.set('pending_equipment_update', {
        id: 'E1',
        original: { equipment_id: 'E1', name: 'Old' },
        changes: { name: 'New' },
    });

    const result = await template.execute('yes', { sessionMemory: memory });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.operation, 'UPDATE');
    assert.ok(result.message.includes('updated successfully'));
    assert.strictEqual(store.updateCalls.length, 1);
    assert.strictEqual(store.updateCalls[0].id, 'E1');
});

test('UPDATE confirmation: no cancels', async () => {
    const store = new RecordStore();
    const { template } = createTemplate({ store });
    const memory = new Map();

    memory.set('pending_equipment_update', {
        id: 'E1',
        original: {},
        changes: { name: 'New' },
    });

    const result = await template.execute('no', { sessionMemory: memory });

    assert.strictEqual(result.operation, 'UPDATE');
    assert.strictEqual(result.cancelled, true);
    assert.strictEqual(store.updateCalls.length, 0);
});

// ============= execute: Unknown operation =============

test('execute returns error for unknown operation', async () => {
    const llm = buildMockLLM({ operation: 'MERGE', data: {} });
    const { template } = createTemplate({ llmAgent: llm });
    const memory = new Map();

    const result = await template.execute('merge records', { sessionMemory: memory });

    assert.strictEqual(result.success, false);
    assert.ok(result.message.includes('Unknown operation'));
});

// ============= handlePendingState priority order =============

test('handlePendingState checks create before update', async () => {
    const store = new RecordStore();
    const { template } = createTemplate({ store });
    const memory = new Map();

    // Set both pending states
    memory.set('pending_equipment_create', {
        record: { equipment_id: 'E1', name: 'Create' },
    });
    memory.set('pending_equipment_update', {
        id: 'E2', original: {}, changes: { name: 'Update' },
    });

    const result = await template.execute('yes', { sessionMemory: memory });

    // Should have handled create (not update)
    assert.strictEqual(result.operation, 'CREATE');
    assert.strictEqual(store.insertCalls.length, 1);
    assert.strictEqual(store.updateCalls.length, 0);
});

test('handlePendingState returns null when no pending state', async () => {
    const { template } = createTemplate();
    const memory = new Map();

    const result = await template.handlePendingState('anything', memory);
    assert.strictEqual(result, null);
});

// ============= Validation corrections flow =============

test('validation correction: cancel aborts', async () => {
    const { template } = createTemplate();
    const memory = new Map();

    memory.set('pending_equipment_validation', {
        operation: 'CREATE',
        record: { name: '' },
        errors: [{ error: 'Name required' }],
    });

    const result = await template.execute('cancel', { sessionMemory: memory });

    assert.strictEqual(result.cancelled, true);
    assert.strictEqual(memory.has('pending_equipment_validation'), false);
});

// ============= execute without sessionMemory =============

test('execute works without sessionMemory (no pending state, no storage)', async () => {
    const store = new RecordStore([
        { equipment_id: 'E1', name: 'Drill' },
    ]);
    const llm = buildMockLLM({ operation: 'SELECT', filter: {}, data: {} });
    const { template } = createTemplate({ store, llmAgent: llm });

    const result = await template.execute('list equipment', {});

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.operation, 'SELECT');
    assert.strictEqual(result.count, 1);
});

test('execute works with null context', async () => {
    const store = new RecordStore([]);
    const llm = buildMockLLM({ operation: 'SELECT', filter: {}, data: {} });
    const { template } = createTemplate({ store, llmAgent: llm });

    const result = await template.execute('list equipment', null);

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.operation, 'SELECT');
    assert.strictEqual(result.count, 0);
});

// ============= Multiple deletes =============

test('DELETE confirmation: yes deletes multiple records', async () => {
    const store = new RecordStore();
    const { template } = createTemplate({ store });
    const memory = new Map();

    memory.set('pending_equipment_delete', {
        records: [
            { equipment_id: 'E1', name: 'Drill' },
            { equipment_id: 'E2', name: 'Saw' },
            { equipment_id: 'E3', name: 'Hammer' },
        ],
    });

    const result = await template.execute('yes', { sessionMemory: memory });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.count, 3);
    assert.deepStrictEqual(store.deleteCalls, ['E1', 'E2', 'E3']);
});

// ============= CREATE flow PK generation =============

test('CREATE flow generates primary key via generatePKValues', async () => {
    const store = new RecordStore();
    const llm = buildMockLLM({
        operation: 'CREATE',
        data: { name: 'Auto PK Drill', status: 'Active' },
    });
    const { template } = createTemplate({ store, llmAgent: llm });
    const memory = new Map();

    await template.execute('add drill', { sessionMemory: memory });

    const pending = memory.get('pending_equipment_create');
    assert.ok(pending, 'Should have pending create');
    assert.strictEqual(pending.record.equipment_id, 'EQP_AUTO_001',
        'Should have auto-generated PK');
});

// ============= CREATE: insert failure =============

test('CREATE confirmation: insert failure returns error', async () => {
    const store = new RecordStore();
    const subsystem = buildMockSubsystem(store);
    subsystem._execContext.insertRecord = async () => {
        throw new Error('DB connection lost');
    };
    const template = new ConversationalTskillController(subsystem, TEST_SKILL, {}, buildMockLLM({}));
    const memory = new Map();

    memory.set('pending_equipment_create', {
        record: { equipment_id: 'E1', name: 'Drill' },
    });

    const result = await template.execute('yes', { sessionMemory: memory });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.operation, 'CREATE');
    assert.ok(result.message.includes('DB connection lost'));
});

// ============= DELETE: delete failure =============

test('DELETE confirmation: delete failure returns error', async () => {
    const store = new RecordStore();
    const subsystem = buildMockSubsystem(store);
    subsystem._execContext.deleteRecord = async () => {
        throw new Error('Foreign key constraint');
    };
    const template = new ConversationalTskillController(subsystem, TEST_SKILL, {}, buildMockLLM({}));
    const memory = new Map();

    memory.set('pending_equipment_delete', {
        records: [{ equipment_id: 'E1' }],
    });

    const result = await template.execute('yes', { sessionMemory: memory });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.operation, 'DELETE');
    assert.ok(result.message.includes('Foreign key constraint'));
});

// ============= UPDATE: update failure =============

test('UPDATE confirmation: update failure returns error', async () => {
    const store = new RecordStore();
    const subsystem = buildMockSubsystem(store);
    subsystem._execContext.updateRecord = async () => {
        throw new Error('Optimistic lock failed');
    };
    const template = new ConversationalTskillController(subsystem, TEST_SKILL, {}, buildMockLLM({}));
    const memory = new Map();

    memory.set('pending_equipment_update', {
        id: 'E1',
        original: { equipment_id: 'E1', name: 'Old' },
        changes: { name: 'New' },
    });

    const result = await template.execute('yes', { sessionMemory: memory });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.operation, 'UPDATE');
    assert.ok(result.message.includes('Optimistic lock failed'));
});

// ============= Natural Language CRUD parsing across tables =============

test('parseOperation: area UPDATE maps natural language ID to area_id', async () => {
    const parsedSkill = {
        tableName: 'area',
        tablePurpose: 'Area tracking',
        primaryKey: 'area_id',
        fields: {
            area_id: { description: 'Area ID' },
            name: { description: 'Area name' },
            location_type: { description: 'Location type' },
        },
    };
    const llm = buildMockLLM({
        operation: 'UPDATE',
        filter: { name: 'a3' },
    });
    const { template } = createTemplate({ parsedSkill, llmAgent: llm });

    const parsed = await template.parseOperation('Update area a3. Change location type from main stores in Tool room');
    assert.strictEqual(parsed.operation, 'UPDATE');
    assert.deepStrictEqual(parsed.filter, { area_id: 'A3' });
});

test('parseOperation: area DELETE honors explicit delete intent and area ID mention', async () => {
    const parsedSkill = {
        tableName: 'area',
        tablePurpose: 'Area tracking',
        primaryKey: 'area_id',
        fields: {
            area_id: { description: 'Area ID' },
            name: { description: 'Area name' },
        },
    };
    const llm = buildMockLLM({
        operation: 'UPDATE',
        filter: { name: 'a6' },
    });
    const { template } = createTemplate({ parsedSkill, llmAgent: llm });

    const parsed = await template.parseOperation('Delete area a6');
    assert.strictEqual(parsed.operation, 'DELETE');
    assert.deepStrictEqual(parsed.filter, { area_id: 'A6' });
});

test('parseOperation: area UPDATE tolerates common typo "aria" for "area"', async () => {
    const parsedSkill = {
        tableName: 'area',
        tablePurpose: 'Area tracking',
        primaryKey: 'area_id',
        fields: {
            area_id: { description: 'Area ID' },
            name: { description: 'Area name' },
        },
    };
    const llm = buildMockLLM({
        operation: 'UPDATE',
        filter: { name: 'a1' },
    });
    const { template } = createTemplate({ parsedSkill, llmAgent: llm });

    const parsed = await template.parseOperation('change name for aria a1 to Shelf Area New');
    assert.strictEqual(parsed.operation, 'UPDATE');
    assert.deepStrictEqual(parsed.filter, { area_id: 'A1' });
});

test('parseOperation: material UPDATE maps "for material <id>" to primary key', async () => {
    const parsedSkill = {
        tableName: 'material',
        tablePurpose: 'Material tracking',
        primaryKey: 'material_id',
        fields: {
            material_id: { description: 'Material ID' },
            quantity: { description: 'Quantity' },
            name: { description: 'Name' },
        },
    };
    const llm = buildMockLLM({
        operation: 'UPDATE',
        filter: { name: 'mat-0001' },
    });
    const { template } = createTemplate({ parsedSkill, llmAgent: llm });

    const parsed = await template.parseOperation('Set quantity to 50 for material MAT-0001');
    assert.strictEqual(parsed.operation, 'UPDATE');
    assert.deepStrictEqual(parsed.filter, { material_id: 'MAT-0001' });
});

test('parseOperation: equipment DELETE maps natural language ID to equipment_id', async () => {
    const parsedSkill = {
        tableName: 'equipment',
        tablePurpose: 'Equipment tracking',
        primaryKey: 'equipment_id',
        fields: {
            equipment_id: { description: 'Equipment ID' },
            name: { description: 'Name' },
        },
    };
    const llm = buildMockLLM({
        operation: 'UPDATE',
        filter: { name: 'crl0192' },
    });
    const { template } = createTemplate({ parsedSkill, llmAgent: llm });

    const parsed = await template.parseOperation('Remove equipment CRL0192 from inventory');
    assert.strictEqual(parsed.operation, 'DELETE');
    assert.deepStrictEqual(parsed.filter, { equipment_id: 'CRL0192' });
});

console.log('ConversationalTskillController tests completed');
