const tables = new Map();

export function openConnection() {
    return {
        insert(table, record) {
            if (!tables.has(table)) {
                tables.set(table, []);
            }
            const rows = tables.get(table);
            rows.push({ ...record });
            return record;
        },
        findAll(table) {
            return [...(tables.get(table) || [])];
        },
        clear(table) {
            tables.set(table, []);
        },
    };
}
