const centers = Array.from({ length: 12 }, (_, index) => ({
    label: `Center ${index + 1}`,
    value: `DC-${index + 1}`,
}));

const centerByValue = new Map(centers.map((entry) => [entry.value, entry.label]));

export const specs = {
    name: 'assign_distribution_region',
    humanDescription: 'a distribution region assignment for logistics',
    description: 'Select an operational region using internal identifiers.',
    arguments: {
        region_code: {
            type: 'string',
            description: 'Operational region for distribution',
            options: centers,
            presenter: (value) => centerByValue.get(value) || value,
            resolver: (value) => {
                if (typeof value !== 'string') {
                    return value;
                }
                const normalized = value.trim().toLowerCase();
                const entry = centers.find(({ label }) => label.toLowerCase() === normalized);
                return entry ? entry.value : value;
            },
        },
    },
    requiredArguments: ['region_code'],
};

export const roles = ['logistics'];

export const action = (args) => args.region_code;

export default {
    specs,
    roles,
    action,
};
