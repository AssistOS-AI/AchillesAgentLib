export const STATUS_SUCCESS = 'success';
export const STATUS_FAIL = 'fail';
export const STATUS_UNDEFINED = 'undefined';
export const STATUS_CANCELED = 'canceled';

export const STATUS_ALIASES = new Map([
    ['cancelled', STATUS_CANCELED],
    ['cancled', STATUS_CANCELED],
    ['canceled', STATUS_CANCELED],
    ['cancel', STATUS_CANCELED],
]);

export const STATUS_SET = new Set([
    STATUS_SUCCESS,
    STATUS_FAIL,
    STATUS_UNDEFINED,
    STATUS_CANCELED,
]);

export function normalizeStatus(statusText) {
    if (!statusText) {
        return null;
    }
    const normalized = String(statusText).trim().toLowerCase();
    if (STATUS_SET.has(normalized)) {
        return normalized;
    }
    return STATUS_ALIASES.get(normalized) ?? null;
}
