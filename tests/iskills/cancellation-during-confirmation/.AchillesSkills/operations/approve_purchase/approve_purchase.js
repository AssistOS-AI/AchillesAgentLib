export const specs = {
    name: 'approve_purchase',
    humanDescription: 'a purchase approval request for operations',
    description: 'Approve a purchase so the operations team can proceed.',
    arguments: {
        item_name: { type: 'string', description: 'Item awaiting approval' },
        amount: { type: 'string', description: 'Total amount to approve' },
    },
    requiredArguments: ['item_name', 'amount'],
};

export const roles = ['finance'];

export const action = (args) => ({ ...args });

export default {
    specs,
    roles,
    action,
};
