export const specs = {
    name: 'capture_requirements',
    humanDescription: 'requirements capture conversation',
    description: 'Collect concise requirements from stakeholders before planning.',
    arguments: {
        input: {
            type: 'string',
            description: 'Primary requirement statement provided by the user.',
        },
    },
    requiredArguments: ['input'],
    needConfirmation: false,
};

export const roles = ['cli'];

export const action = ({ input }) => ({
    captured: typeof input === 'string' ? input.trim() : '',
});
