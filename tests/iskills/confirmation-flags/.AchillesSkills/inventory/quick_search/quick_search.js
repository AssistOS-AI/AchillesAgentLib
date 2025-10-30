export const specs = {
    name: 'quick_search',
    humanDescription: 'a quick search',
    description: 'Perform a quick search.',
    needConfirmation: false,
    arguments: {
        query: { type: 'string', description: 'Search query' },
        limit: { type: 'integer', description: 'Maximum results' },
    },
    requiredArguments: ['query'],
};

export const roles = ['user'];

export const action = (args) => ({ ...args });

export default {
    specs,
    roles,
    action,
};
