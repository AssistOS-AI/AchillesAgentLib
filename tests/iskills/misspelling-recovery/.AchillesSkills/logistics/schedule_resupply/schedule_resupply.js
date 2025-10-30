const warehouses = [
    { label: 'Berlin Central Warehouse', value: 'WH-DE-01' },
    { label: 'Munich Flagship Depot', value: 'WH-DE-09' },
    { label: 'Hamburg River Hub', value: 'WH-DE-12' },
];

const warehouseById = new Map(warehouses.map((entry) => [entry.value, entry.label]));
const warehouseTokens = warehouses.map((entry) => ({
    ...entry,
    token: entry.label.toLowerCase().replace(/[^a-z0-9]/g, ''),
}));

const editDistance = (a, b) => {
    if (a === b) {
        return 0;
    }
    const rows = a.length + 1;
    const cols = b.length + 1;
    const matrix = Array.from({ length: rows }, () => Array(cols).fill(0));
    for (let i = 0; i < rows; i += 1) {
        matrix[i][0] = i;
    }
    for (let j = 0; j < cols; j += 1) {
        matrix[0][j] = j;
    }
    for (let i = 1; i < rows; i += 1) {
        for (let j = 1; j < cols; j += 1) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            matrix[i][j] = Math.min(
                matrix[i - 1][j] + 1,
                matrix[i][j - 1] + 1,
                matrix[i - 1][j - 1] + cost,
            );
        }
    }
    return matrix[rows - 1][cols - 1];
};

function resolveWarehouse(value) {
    if (typeof value !== 'string') {
        return value;
    }
    const token = value.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!token) {
        return value;
    }
    let best = null;
    let bestDistance = Infinity;
    for (const candidate of warehouseTokens) {
        if (candidate.token === token) {
            return candidate.value;
        }
        const distance = editDistance(token, candidate.token);
        if (distance < bestDistance) {
            best = candidate;
            bestDistance = distance;
        }
    }
    if (best && bestDistance <= Math.max(1, Math.floor(best.token.length * 0.2))) {
        return best.value;
    }
    return value;
}

export const specs = {
    name: 'schedule_resupply',
    humanDescription: 'a resupply plan for retail warehouses',
    description: 'Identify the warehouse to restock using internal identifiers.',
    arguments: {
        target_warehouse_id: {
            type: 'string',
            description: 'Warehouse to restock',
            options: warehouses,
            presenter: (value) => warehouseById.get(value) || value,
            resolver: resolveWarehouse,
        },
        quantity: { type: 'integer', description: 'Units to dispatch' },
    },
    requiredArguments: ['target_warehouse_id', 'quantity'],
};

export const roles = ['logistics'];

export const action = (args) => ({ ...args });

export default {
    specs,
    roles,
    action,
};
