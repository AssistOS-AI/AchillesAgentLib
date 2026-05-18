export const AKU_ERROR_CODES = Object.freeze({
    AKU_NOT_FOUND: 'AKU_NOT_FOUND',
    AKU_ALREADY_EXISTS: 'AKU_ALREADY_EXISTS',
    AKU_LOCK_TIMEOUT: 'AKU_LOCK_TIMEOUT',
    AKU_STALE_LOCK: 'AKU_STALE_LOCK',
    AKU_CORRUPT_INDEX: 'AKU_CORRUPT_INDEX',
    AKU_SCHEMA_ERROR: 'AKU_SCHEMA_ERROR',
    AKU_PATH_ESCAPE: 'AKU_PATH_ESCAPE',
    AKU_INVALID_STATUS: 'AKU_INVALID_STATUS',
    AKU_TRANSACTION_PENDING: 'AKU_TRANSACTION_PENDING',
    AKU_REBUILD_REQUIRED: 'AKU_REBUILD_REQUIRED',
});

export class AKUError extends Error {
    constructor(code, message, details = {}) {
        super(message);
        this.name = 'AKUError';
        this.code = code;
        this.details = details;
    }
}

export function akuError(code, message, details = {}) {
    return new AKUError(code, message, details);
}

export function wrapAsAKUError(error, code, message, details = {}) {
    if (error instanceof AKUError) {
        return error;
    }
    return new AKUError(code, message, {
        ...details,
        cause: error?.message ?? String(error),
    });
}
