export const specs = {
    name: 'delete_item',
    humanDescription: 'item deletion',
    description: 'Delete an item from the inventory.',
    needConfirmation: true,
    arguments: {
        item_id: { type: 'string', description: 'ID of the item to delete' },
    },
    requiredArguments: ['item_id'],
};

export const roles = ['admin'];

export const action = (args) => ({ ...args });

export default {
    specs,
    roles,
    action,
};
