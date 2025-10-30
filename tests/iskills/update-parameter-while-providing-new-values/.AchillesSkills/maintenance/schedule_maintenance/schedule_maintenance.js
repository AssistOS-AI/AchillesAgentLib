export const specs = {
    name: 'schedule_maintenance',
    humanDescription: 'a maintenance task for factory equipment',
    description: 'Schedule preventative maintenance for factory assets.',
    arguments: {
        machine_name: { type: 'string', description: 'Equipment needing service' },
        window_start: { type: 'string', description: 'When the work should start' },
        window_end: { type: 'string', description: 'When the maintenance window should close' },
        priority: {
            type: 'string',
            description: 'Maintenance priority',
            enumerator: () => [
                { label: 'Low', value: 'low' },
                { label: 'Medium', value: 'medium' },
                { label: 'High', value: 'high' },
            ],
        },
    },
    requiredArguments: ['machine_name', 'priority'],
};

export const roles = ['maintenance'];

export const action = (args) => ({ ...args });

export default {
    specs,
    roles,
    action,
};
