export const specs = {
    name: 'update_item',
    humanDescription: 'item update',
    description: 'Update an item in the inventory.',
    arguments: {
        item_id: { type: 'string', description: 'ID of the item to update' },
        new_name: { type: 'string', description: 'New name for the item' },
    },
    requiredArguments: ['item_id', 'new_name'],
};

export const roles = ['admin'];

export const action = (args) => ({ ...args });

export default {
    specs,
    roles,
    action,
};
