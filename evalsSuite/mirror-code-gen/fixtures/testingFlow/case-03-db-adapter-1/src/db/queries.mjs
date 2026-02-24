export function buildInsert(table, record) {
    return { table, record };
}

export function buildSelectAll(table) {
    return { table };
}
