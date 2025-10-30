export const specs = {
    name: 'schedule_project_rotation',
    humanDescription: 'a project rotation schedule for the engineering team',
    description: 'Schedule a rotation, capturing timing and leadership.',
    arguments: {
        project_code: { type: 'string', description: 'Internal project identifier' },
        location: { type: 'string', description: 'Primary office location' },
        start_date: { type: 'string', description: 'Rotation start date' },
        end_date: { type: 'string', description: 'Rotation end date' },
        supervisor: { type: 'string', description: 'Primary supervisor overseeing the rotation' },
        backup_supervisor: { type: 'string', description: 'Backup supervisor for coverage' },
        priority: {
            type: 'string',
            description: 'Urgency level for the rotation',
            enumerator: () => [
                { label: 'Low', value: 'low' },
                { label: 'Medium', value: 'medium' },
                { label: 'High', value: 'high' },
            ],
        },
    },
    requiredArguments: ['project_code', 'location', 'start_date', 'end_date', 'supervisor'],
};

export const roles = ['operations'];

export const action = (args) => ({ ...args });

export default {
    specs,
    roles,
    action,
};
