import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const mappingPath = path.join(__dirname, '..', '..', '..', 'fixtures', 'inventoryMapping.json');

const mapping = JSON.parse(fs.readFileSync(mappingPath, 'utf8'));

function buildOptions(section) {
    return Object.entries(section).map(([label, meta]) => ({
        label,
        value: meta.id,
    }));
}

const sources = Object.entries(mapping.sourceWarehouses).reduce((acc, [label, meta]) => {
    acc.idToLabel.set(meta.id, label);
    acc.labelToId.set(label.toLowerCase(), meta.id);
    return acc;
}, { idToLabel: new Map(), labelToId: new Map() });

const destinations = Object.entries(mapping.destinationWarehouses).reduce((acc, [label, meta]) => {
    acc.idToLabel.set(meta.id, label);
    acc.labelToId.set(label.toLowerCase(), meta.id);
    return acc;
}, { idToLabel: new Map(), labelToId: new Map() });

const skus = Object.entries(mapping.skus).reduce((acc, [label, meta]) => {
    acc.idToLabel.set(meta.id, label);
    acc.labelToId.set(label.toLowerCase(), meta.id);
    return acc;
}, { idToLabel: new Map(), labelToId: new Map() });

const presentWith = (lookup) => (value) => lookup.idToLabel.get(value) || value;

export const specs = {
    name: 'assign_inventory_transfer',
    humanDescription: 'an inventory transfer assignment between warehouses',
    description: 'Route inventory to the correct destination using internal identifiers.',
    arguments: {
        source_warehouse_id: {
            type: 'string',
            description: 'Origin warehouse',
            options: buildOptions(mapping.sourceWarehouses),
            presenter: presentWith(sources),
        },
        destination_warehouse_id: {
            type: 'string',
            description: 'Destination warehouse',
            options: buildOptions(mapping.destinationWarehouses),
            presenter: presentWith(destinations),
        },
        sku_id: {
            type: 'string',
            description: 'SKU to transfer',
            options: buildOptions(mapping.skus),
            presenter: presentWith(skus),
        },
        quantity: { type: 'integer', description: 'Quantity to move' },
    },
    requiredArguments: ['source_warehouse_id', 'destination_warehouse_id', 'sku_id', 'quantity'],
};

export const roles = ['logistics'];

export const action = (args) => ({ ...args });

export default {
    specs,
    roles,
    action,
};
