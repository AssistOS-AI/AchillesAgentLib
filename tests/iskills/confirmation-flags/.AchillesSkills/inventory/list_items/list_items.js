export const specs = {
    name: 'list_items',
    humanDescription: 'a list of items',
    description: 'List all items in the inventory.',
    needConfirmation: false,
    arguments: {
        category: { type: 'string', description: 'Item category to filter by' },
    },
    requiredArguments: [],
};

export const roles = ['viewer'];

export const action = (args) => ({ ...args });

export default {
    specs,
    roles,
    action,
};
