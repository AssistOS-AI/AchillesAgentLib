const storage = new Map();

export function put(table, record) {
    if (!storage.has(table)) {
        storage.set(table, []);
    }
    storage.get(table).push({ ...record });
}

export function list(table) {
    return [...(storage.get(table) || [])];
}

export function clear(table) {
    storage.set(table, []);
}
