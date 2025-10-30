export const specs = {
    name: 'create_record',
    humanDescription: 'a new record creation',
    description: 'Create a new record with validated inputs.',
    arguments: {
        record_name: { type: 'string', description: 'Name for the record' },
        record_type: { type: 'string', description: 'Type of record to create' },
    },
    requiredArguments: ['record_name', 'record_type'],
};

export const roles = ['admin'];

export const action = (args) => ({ ...args });

export default {
    specs,
    roles,
    action,
};
