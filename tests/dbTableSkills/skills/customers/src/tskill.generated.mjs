const STATUS_VALUES = ["active", "inactive", "pending", "suspended"];

function isEmptyRequired(value) {
    return value === null || value === undefined || value === '';
}

function toTitleCase(input) {
    return String(input)
        .toLowerCase()
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}

function validator_customer_id(value, record) {
    if (isEmptyRequired(value)) {
        return JSON.stringify({ field: 'customer_id', error: 'customer_id is required', value });
    }
    let valid = false;
    if (typeof value === 'number' && Number.isInteger(value)) {
        valid = true;
    } else if (typeof value === 'string') {
        const trimmed = value.trim();
        if (/^-?\d+$/.test(trimmed)) {
            valid = true;
        }
    }
    if (!valid) {
        return JSON.stringify({ field: 'customer_id', error: 'customer_id must be a valid integer', value });
    }
    return '';
}

function validator_name(value, record) {
    if (isEmptyRequired(value)) {
        return JSON.stringify({ field: 'name', error: 'name is required', value });
    }
    const str = String(value).trim();
    if (str.length < 2 || str.length > 200) {
        return JSON.stringify({ field: 'name', error: 'name must be between 2 and 200 characters', value });
    }
    if (!/[a-zA-Z]/.test(str)) {
        return JSON.stringify({ field: 'name', error: 'name must contain alphabetic characters', value });
    }
    return '';
}

function validator_email(value, record) {
    if (isEmptyRequired(value)) {
        return JSON.stringify({ field: 'email', error: 'email is required', value });
    }
    const str = String(value).trim();
    const pattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!pattern.test(str)) {
        return JSON.stringify({ field: 'email', error: 'email must be a valid email address', value });
    }
    return '';
}

function validator_status(value, record) {
    if (isEmptyRequired(value)) {
        return JSON.stringify({ field: 'status', error: 'status is required', value });
    }
    const str = String(value).toLowerCase().trim();
    if (!STATUS_VALUES.includes(str)) {
        return JSON.stringify({ field: 'status', error: 'status must be one of: active, inactive, pending, suspended', value });
    }
    return '';
}

function presenter_name(value, record) {
    if (value === null || value === undefined) return '—';
    return toTitleCase(value);
}

function presenter_email(value, record) {
    if (value === null || value === undefined) return '—';
    return String(value).toLowerCase();
}

function presenter_status(value, record) {
    if (value === null || value === undefined) return '—';
    return String(value).toUpperCase();
}

function resolver_name(value, record) {
    if (value === null || value === undefined) return null;
    return toTitleCase(value);
}

function resolver_email(value, record) {
    if (value === null || value === undefined) return null;
    return String(value).toLowerCase().trim();
}

function resolver_status(value, record) {
    if (value === null || value === undefined) return null;
    const resolved = String(value).toLowerCase().trim();
    if (!STATUS_VALUES.includes(resolved)) return null;
    return resolved;
}

function enumerator_status(context) {
    return [...STATUS_VALUES];
}

function derivator_display_name(record) {
    const name = record?.name ?? '';
    const status = record?.status ?? '';
    return `${name} (${status})`;
}

function generatePKValues(record, existingRecords = []) {
    if (record && record.customer_id !== null && record.customer_id !== undefined && record.customer_id !== '') {
        return { customer_id: record.customer_id };
    }
    let maxId = 0;
    if (Array.isArray(existingRecords)) {
        for (const rec of existingRecords) {
            const val = rec?.customer_id;
            const num = typeof val === 'number' ? val : parseInt(val, 10);
            if (Number.isInteger(num) && num > maxId) {
                maxId = num;
            }
        }
    }
    return { customer_id: maxId + 1 };
}

async function prepareRecord(record, context) {
    const prepared = { ...record };
    if ('name' in prepared) prepared.name = resolver_name(prepared.name, prepared);
    if ('email' in prepared) prepared.email = resolver_email(prepared.email, prepared);
    if ('status' in prepared) prepared.status = resolver_status(prepared.status, prepared);
    prepared.display_name = derivator_display_name(prepared);
    return prepared;
}

async function validateRecord(record) {
    const errors = [];
    const validators = [
        ['customer_id', validator_customer_id],
        ['name', validator_name],
        ['email', validator_email],
        ['status', validator_status],
    ];
    for (const [fieldName, validatorFn] of validators) {
        const result = validatorFn(record[fieldName], record);
        if (result) {
            try {
                errors.push(JSON.parse(result));
            } catch {
                errors.push({ field: fieldName, error: result, value: record[fieldName] });
            }
        }
    }
    return { isValid: errors.length === 0, errors };
}

async function validateDelete(recordId, record, context = {}) {
    const errors = [];
    const guardMode = String(context?.deleteGuard?.mode || '').toLowerCase();

    if (guardMode === 'block_if_referenced' && typeof context.checkDeleteReferences === 'function') {
        const message = await context.checkDeleteReferences(recordId, record);
        if (message) {
            errors.push({
                field: context.primaryKey || 'id',
                error: String(message),
                value: recordId,
            });
        }
    }

    return { isValid: errors.length === 0, errors };
}

async function presentRecord(record) {
    if (!record) return record;
    const presented = { ...record };

    if (record.name !== undefined) {
        presented.name = presenter_name(record.name, record);
    }
    if (record.email !== undefined) {
        presented.email = presenter_email(record.email, record);
    }
    if (record.status !== undefined) {
        presented.status = presenter_status(record.status, record);
    }

    return presented;
}

export {
    validator_customer_id,
    validator_name,
    validator_email,
    validator_status,
    presenter_name,
    presenter_email,
    presenter_status,
    resolver_name,
    resolver_email,
    resolver_status,
    enumerator_status,
    derivator_display_name,
    generatePKValues,
    prepareRecord,
    validateRecord,
    validateDelete,
    presentRecord,
};

export const functions = {
    global: {
        validator_customer_id,
        validator_name,
        validator_email,
        validator_status,
        presenter_name,
        presenter_email,
        presenter_status,
        resolver_name,
        resolver_email,
        resolver_status,
        enumerator_status,
        derivator_display_name,
        generatePKValues,
        prepareRecord,
        validateRecord,
        validateDelete,
        presentRecord,
    }
};