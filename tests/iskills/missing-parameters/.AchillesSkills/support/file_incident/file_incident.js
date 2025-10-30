export const specs = {
    name: 'file_incident',
    humanDescription: 'a support incident record for the warehouse printers',
    description: 'File a support incident so the warehouse printers can be restored.',
    arguments: {
        incident_title: { type: 'string', description: 'Short incident headline' },
        severity: {
            type: 'string',
            description: 'Incident severity level',
            enumerator: () => [
                { label: 'Low', value: 'low' },
                { label: 'Medium', value: 'medium' },
                { label: 'High', value: 'high' },
            ],
            resolver: (value) => (typeof value === 'string' ? value.trim().toLowerCase() : value),
        },
        assigned_team: { type: 'string', description: 'Team that will follow up on the incident' },
    },
    requiredArguments: ['incident_title', 'severity'],
};

export const roles = ['support'];

export const action = (args) => ({ ...args });

export default {
    specs,
    roles,
    action,
};
