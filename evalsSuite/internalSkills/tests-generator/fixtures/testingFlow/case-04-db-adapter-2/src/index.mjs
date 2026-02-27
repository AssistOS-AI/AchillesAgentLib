import { put, list, clear } from './db/store.mjs';
import { mapRecord } from './db/mapper.mjs';

export function saveOrder(order) {
    const mapped = mapRecord(order);
    put('orders', mapped);
    return mapped;
}

export function listOrders() {
    return list('orders');
}

export function resetOrders() {
    clear('orders');
}
