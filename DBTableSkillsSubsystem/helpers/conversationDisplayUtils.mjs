import {
    HIDDEN_AUDIT_FIELDS,
    NULL_DISPLAY_VALUE,
    DEFAULT_SELECTION_PAGE_SIZE,
} from '../constants.mjs';

export const INTERNAL_RESPONSE_FIELDS = new Set(['id']);

function resolveDefaultFieldLabel(fieldName, fieldDef = {}) {
    const explicitShort = fieldDef?.shortLabel
        || fieldDef?.short_label
        || fieldDef?.label
        || null;

    if (explicitShort && String(explicitShort).trim()) {
        return stripExampleHints(explicitShort) || String(explicitShort).trim();
    }

    const normalizedFieldName = String(fieldName || '').trim();
    if (normalizedFieldName) return normalizedFieldName;

    return humanizeFieldName(fieldName) || String(fieldName || '');
}

/**
 * Format a record as a markdown table for display.
 * @param {Object} record - Record to format
 * @param {Object} fields - Field definitions from parsedSkill
 * @param {string[]} [excludeFields] - Fields to exclude from display
 * @returns {string} Markdown table
 */
export function formatRecordTable(record, fields, excludeFields = [], options = {}) {
    const hiddenFields = new Set([
        ...HIDDEN_AUDIT_FIELDS,
        ...excludeFields,
    ]);
    const resolveLabel = typeof options.resolveLabel === 'function'
        ? options.resolveLabel
        : ((fieldName, fieldDef) => resolveDefaultFieldLabel(fieldName, fieldDef));

    const rows = [];
    rows.push('| Field | Value |');
    rows.push('|-------|-------|');

    for (const [fieldName, fieldDef] of Object.entries(fields || {})) {
        if (hiddenFields.has(fieldName)) continue;
        const value = record[fieldName];
        const displayValue = value === undefined || value === null ? NULL_DISPLAY_VALUE : String(value);
        const label = resolveLabel(fieldName, fieldDef);
        rows.push(`| ${label} | ${displayValue} |`);
    }

    return rows.join('\n');
}

/**
 * Format a list of records as a markdown table.
 * @param {Object[]} records - Records to format
 * @param {Object} fields - Field definitions
 * @param {string} entityName - Entity name for header
 * @returns {string} Markdown table
 */
export function formatRecordsTable(records, fields, entityName, options = {}) {
    if (!records || records.length === 0) {
        return `No ${entityName} records found.`;
    }
    const resolveLabel = typeof options.resolveLabel === 'function'
        ? options.resolveLabel
        : ((fieldName, fieldDef) => resolveDefaultFieldLabel(fieldName, fieldDef));

    const hiddenFields = new Set(HIDDEN_AUDIT_FIELDS);

    // Get visible field names
    const visibleFields = Object.entries(fields || {})
        .filter(([name]) => !hiddenFields.has(name));

    if (visibleFields.length === 0) return JSON.stringify(records, null, 2);

    const header = visibleFields.map(([name, def]) => resolveLabel(name, def)).join(' | ');
    const separator = visibleFields.map(() => '---').join(' | ');

    const rows = records.map(record =>
        visibleFields.map(([name]) => {
            const val = record[name];
            return val === undefined || val === null ? NULL_DISPLAY_VALUE : String(val);
        }).join(' | ')
    );

    return [
        `| ${header} |`,
        `| ${separator} |`,
        ...rows.map(r => `| ${r} |`),
    ].join('\n');
}

export function escapeRegex(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function stripExampleHints(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    // Remove parenthesized example hints such as:
    // (e.g., "..."), (eg. "..."), (for example: ...)
    const withoutExamples = raw.replace(/\s*\((?:e\.?\s*g\.?|for example)[^)]*\)\s*/gi, ' ');
    return withoutExamples.replace(/\s+/g, ' ').trim();
}

export function humanizeFieldName(fieldName) {
    const text = String(fieldName || '').trim();
    if (!text) return '';
    return text
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .replace(/\b\w/g, char => char.toUpperCase());
}

export function sanitizeRecordForUser(record) {
    if (!record || typeof record !== 'object') return record;
    const sanitized = {};
    for (const [key, value] of Object.entries(record)) {
        if (INTERNAL_RESPONSE_FIELDS.has(key)) continue;
        sanitized[key] = value;
    }
    return sanitized;
}

export function sanitizeRecordsForUser(records) {
    if (!Array.isArray(records)) return [];
    return records.map(record => sanitizeRecordForUser(record));
}

export function paginateRecords(records, page = 0, pageSize = DEFAULT_SELECTION_PAGE_SIZE) {
    const normalizedRecords = Array.isArray(records) ? records : [];
    const normalizedPageSize = Number.isFinite(pageSize) && pageSize > 0
        ? Math.floor(pageSize)
        : DEFAULT_SELECTION_PAGE_SIZE;

    const total = normalizedRecords.length;
    const totalPages = Math.max(1, Math.ceil(total / normalizedPageSize));
    const rawPage = Number.isFinite(page) ? Math.floor(page) : 0;
    const safePage = Math.min(Math.max(rawPage, 0), totalPages - 1);

    const start = safePage * normalizedPageSize;
    const end = Math.min(start + normalizedPageSize, total);
    const items = normalizedRecords.slice(start, end);

    return {
        items,
        total,
        totalPages,
        page: safePage,
        pageSize: normalizedPageSize,
        start,
        end,
    };
}
