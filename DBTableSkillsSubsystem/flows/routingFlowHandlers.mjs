import { isNoResponse } from '../../utils/ConfirmationUtils.mjs';
import {
    PENDING_STATE_SUFFIXES,
    pendingKey,
    DEFAULT_SELECTION_PAGE_SIZE,
} from '../constants.mjs';
import {
    buildParseOperationPrompt,
    formatFieldInfo,
} from '../templates/prompts.mjs';
import {
    paginateRecords,
    formatRecordsTable,
    sanitizeRecordsForUser,
} from '../helpers/conversationDisplayUtils.mjs';

const SELECT_PREFIX_RE = /^\s*(list|show|display|view|get|find|search)\b/i;
const MUTATION_PREFIX_RE = /^\s*(add|create|new|insert|update|edit|change|delete|remove|drop)\b/i;
const PK_SHORTCUT_RE = /^\s*(update|edit|change|delete|remove|drop)\s+([a-zA-Z_][\w-]*)\s+([^\s,.;:!?]+)\b/i;
const SELECT_PK_SHORTCUT_RE = /^\s*(list|show|display|view|get|find|search)\s+([a-zA-Z_][\w-]*)\s+([^\s,]+)\s*$/i;
const SELECT_FIRST_RE = /\b(?:first|top)\s+(\d+)\b/i;
const SELECT_LAST_RE = /\blast\s+(\d+)\b/i;
const SELECT_LIMIT_RE = /\blimit\s+(\d+)\b/i;
const SELECT_MAX_WINDOW_LIMIT = 1000;
const SELECT_FILTER_QUERY_KEYS_NORMALIZED = new Set([
    'limit',
    'count',
    'take',
    'first',
    'last',
    'window',
    'slice',
    'position',
    'page',
    'pagesize',
    'offset',
    'orderby',
    'sort',
    'sortby',
    'order',
    'direction',
    'descending',
    'ascending',
]);
const CREATE_KEYWORDS = ['create', 'add', 'new', 'insert', 'make', 'register'];
const UPDATE_KEYWORDS = ['change', 'update', 'modify', 'edit', 'set', 'assign', 'mark'];
const DELETE_KEYWORDS = ['delete', 'remove', 'drop', 'erase'];
const CREATE_PREFIX_RE = /^\s*(create|add|new|insert|make|register)\b/i;
const UPDATE_PREFIX_RE = /^\s*(update|edit|change|modify|set|assign|mark)\b/i;
const DELETE_PREFIX_RE = /^\s*(delete|remove|drop|erase)\b/i;
const ID_STOPWORDS = new Set(['id', 'in', 'with', 'where', 'from', 'to', 'for', 'of', 'the', 'a', 'an']);

function looksLikeSelectCommand(prompt) {
    const text = String(prompt || '').trim().toLowerCase();
    if (!text) return false;
    if (!SELECT_PREFIX_RE.test(text)) return false;
    if (MUTATION_PREFIX_RE.test(text)) return false;
    return true;
}

function normalizeEntity(entityName) {
    return String(entityName || '').trim().toLowerCase();
}

function getEntityVariants(entityName) {
    const entity = normalizeEntity(entityName);
    if (!entity) return [];
    const variants = new Set([entity, `${entity}s`]);
    // Common misspelling seen in prompts: "aria" instead of "area".
    if (entity === 'area') {
        variants.add('aria');
        variants.add('arias');
    }
    return Array.from(variants);
}

function canonicalizePrimaryKeyToken(entityName, token) {
    const clean = stripWrappingQuotes(token);
    if (!clean) return null;
    if (normalizeEntity(entityName) === 'area') return clean.toUpperCase();
    return clean;
}

function isLikelyIdToken(token) {
    const clean = String(token || '').trim();
    if (!clean) return false;
    if (clean.includes('=')) return false;
    // Favor strict identifiers (A3, MAT-0001, CRL0192, JOB-12, etc.)
    return /[0-9]/.test(clean);
}

function extractEntityIdMention(prompt, entityName) {
    const text = String(prompt || '').trim();
    if (!text) return null;

    const variants = getEntityVariants(entityName);
    if (variants.length === 0) return null;
    for (const variant of variants) {
        const safeEntity = variant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const patterns = [
            new RegExp(`\\b(?:for|of|in)\\s+${safeEntity}\\s+id\\s+([A-Za-z0-9_-]+)\\b`, 'i'),
            new RegExp(`\\b${safeEntity}\\s+id\\s+([A-Za-z0-9_-]+)\\b`, 'i'),
            new RegExp(`\\b(?:for|of|in)\\s+${safeEntity}\\s+([A-Za-z0-9_-]+)\\b`, 'i'),
            new RegExp(`\\b${safeEntity}\\s+([A-Za-z0-9_-]+)\\b`, 'i'),
            new RegExp(`\\b${safeEntity}#\\s*([A-Za-z0-9_-]+)\\b`, 'i'),
        ];

        for (const re of patterns) {
            const match = text.match(re);
            if (!match) continue;
            const candidate = canonicalizePrimaryKeyToken(entityName, match[1]);
            if (!candidate || ID_STOPWORDS.has(String(candidate).toLowerCase())) continue;
            if (candidate && isLikelyIdToken(candidate)) {
                return candidate;
            }
        }
    }

    return null;
}

function extractPrimaryKeyShortcut(prompt, entityName) {
    const text = String(prompt || '').trim();
    const targetEntity = String(entityName || '').trim().toLowerCase();
    if (!text || !targetEntity) return null;

    const match = text.match(PK_SHORTCUT_RE);
    if (!match) return null;

    const mentionedEntity = String(match[2] || '').trim().toLowerCase();
    const entityMatches = mentionedEntity === targetEntity || mentionedEntity === `${targetEntity}s`;
    if (!entityMatches) return null;

    const candidate = stripWrappingQuotes(match[3]);
    if (!candidate) return null;
    if (ID_STOPWORDS.has(String(candidate).toLowerCase())) return null;
    if (!isLikelyIdToken(candidate)) return null;

    if (String(entityName || '').trim().toLowerCase() === 'area') {
        return candidate.toUpperCase();
    }

    return candidate;
}

function extractSelectPrimaryKeyShortcut(prompt, entityName) {
    const text = String(prompt || '').trim();
    const targetEntity = String(entityName || '').trim().toLowerCase();
    if (!text || !targetEntity) return null;
    if (/\b(?:with|where)\b/i.test(text)) return null;

    const match = text.match(SELECT_PK_SHORTCUT_RE);
    if (!match) return null;

    const mentionedEntity = String(match[2] || '').trim().toLowerCase();
    const entityMatches = mentionedEntity === targetEntity || mentionedEntity === `${targetEntity}s`;
    if (!entityMatches) return null;

    const candidate = stripWrappingQuotes(match[3]);
    if (!candidate) return null;
    if (candidate.includes('=')) return null;
    if (/^\d+$/.test(candidate)) return null;

    if (String(entityName || '').trim().toLowerCase() === 'area') {
        return candidate.toUpperCase();
    }

    return candidate;
}

function normalizePositiveLimit(value) {
    const parsed = Number.parseInt(String(value || '').trim(), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return Math.min(parsed, SELECT_MAX_WINDOW_LIMIT);
}

function normalizeMetaKey(key) {
    return String(key || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');
}

function isSelectQueryHintKey(key) {
    const normalized = normalizeMetaKey(key);
    if (!normalized) return false;
    return SELECT_FILTER_QUERY_KEYS_NORMALIZED.has(normalized);
}

function stripWrappingQuotes(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    const unwrapped = text
        .replace(/^["'`“”]+/, '')
        .replace(/["'`“”]+$/, '')
        .replace(/[.,;!?]+$/, '')
        .trim();
    return unwrapped;
}

function resolveFieldNameFromPhrase(controller, phrase) {
    const normalizedPhrase = controller.normalizeMatchText(phrase);
    if (!normalizedPhrase) return null;

    const fields = Object.keys(controller.fields || {});
    let bestField = null;
    let bestScore = 0;

    for (const fieldName of fields) {
        const candidates = controller.getNormalizedFieldCandidates(fieldName);
        for (const candidate of candidates) {
            if (!candidate) continue;
            if (candidate === normalizedPhrase) return fieldName;
            if (normalizedPhrase.includes(candidate) || candidate.includes(normalizedPhrase)) {
                const score = Math.min(candidate.length, normalizedPhrase.length);
                if (score > bestScore) {
                    bestScore = score;
                    bestField = fieldName;
                }
            }
        }
    }

    return bestField;
}

function parseSelectConditionFromPrompt(controller, prompt) {
    const text = String(prompt || '').trim();
    if (!text) return null;

    let match = text.match(/\b(?:with|where)\s+([a-zA-Z_][\w\s-]{0,40}?)\s+(does not contain|contains|is not|is|!=|=)\s+(.+)$/i);
    let operator = 'equals';
    let fieldPhrase = '';
    let valuePhrase = '';

    if (match) {
        fieldPhrase = String(match[1] || '').trim();
        const rawOperator = String(match[2] || '').trim().toLowerCase();
        if (rawOperator === 'contains') {
            operator = 'contains';
        } else if (rawOperator === 'does not contain') {
            operator = 'not_contains';
        } else if (rawOperator === 'is not' || rawOperator === '!=') {
            operator = 'not_equals';
        } else {
            operator = 'equals';
        }
        valuePhrase = String(match[3] || '').trim();
    } else {
        match = text.match(/\b(?:with|where)\s+([a-zA-Z_][\w\s-]{0,40}?)\s+(.+)$/i);
        if (!match) return null;
        fieldPhrase = String(match[1] || '').trim();
        valuePhrase = String(match[2] || '').trim();
    }

    const fieldName = resolveFieldNameFromPhrase(controller, fieldPhrase);
    const value = stripWrappingQuotes(valuePhrase);
    if (!fieldName || !value) return null;

    return {
        field: fieldName,
        operator,
        value,
    };
}

function parseWhereClauseFromPrompt(prompt = '') {
    const text = String(prompt || '').trim();
    if (!text) return '';
    const match = text.match(/\b(?:where|with)\s+(.+)$/i);
    return match ? String(match[1] || '').trim() : '';
}

function parseSelectConditionsFromPrompt(controller, prompt) {
    const clause = parseWhereClauseFromPrompt(prompt);
    if (!clause) return [];

    const conditions = [];
    const conditionRegex = /\s*(?:(and|or)\s+)?([a-zA-Z_][\w\s-]{0,60}?)\s+(does not contain|not contains|contains|is not|is|not equal to|different from|!=|=|>=|<=|>|<|before|after|between|from|at least|at most|more than|less than|more then|less then|greater than|greater then|starts with|ends with|in|not in)\s+(.+?)(?=\s+\b(?:and|or)\b\s+[a-zA-Z_]|$)/gi;
    let match;
    while ((match = conditionRegex.exec(clause)) !== null) {
        const joinWithPrevious = String(match[1] || 'and').trim().toLowerCase();
        const fieldPhrase = String(match[2] || '').trim();
        const rawOperator = String(match[3] || '').trim().toLowerCase();
        const rawValue = String(match[4] || '').trim();
        const fieldName = resolveFieldNameFromPhrase(controller, fieldPhrase);
        if (!fieldName || !rawValue) continue;

        let operator = 'equals';
        if (rawOperator === 'contains') operator = 'contains';
        if (rawOperator === 'does not contain' || rawOperator === 'not contains') operator = 'not_contains';
        if (rawOperator === 'is not' || rawOperator === '!=' || rawOperator === 'not equal to' || rawOperator === 'different from') operator = 'not_equals';
        if (rawOperator === '>' || rawOperator === 'after' || rawOperator === 'more than' || rawOperator === 'more then' || rawOperator === 'greater than' || rawOperator === 'greater then') operator = 'gt';
        if (rawOperator === '>=' || rawOperator === 'at least') operator = 'gte';
        if (rawOperator === '<' || rawOperator === 'before' || rawOperator === 'less than' || rawOperator === 'less then') operator = 'lt';
        if (rawOperator === '<=' || rawOperator === 'at most') operator = 'lte';
        if (rawOperator === 'between' || rawOperator === 'from') operator = 'between';
        if (rawOperator === 'starts with') operator = 'starts_with';
        if (rawOperator === 'ends with') operator = 'ends_with';
        if (rawOperator === 'in') operator = 'in';
        if (rawOperator === 'not in') operator = 'not_in';

        if (operator === 'between') {
            const betweenParts = rawValue
                .split(/\s+\b(?:and|to)\b\s+/i)
                .map(part => stripWrappingQuotes(part));
            if (betweenParts.length !== 2 || !betweenParts[0] || !betweenParts[1]) continue;
            conditions.push({
                field: fieldName,
                operator,
                value: betweenParts[0],
                valueTo: betweenParts[1],
                joinWithPrevious,
            });
            continue;
        }

        const cleanedValue = stripWrappingQuotes(rawValue);
        if (!cleanedValue) continue;
        conditions.push({
            field: fieldName,
            operator,
            value: cleanedValue,
            joinWithPrevious,
        });
    }

    return conditions;
}

function normalizeOperatorAlias(rawOperator = '') {
    const normalized = String(rawOperator || '').trim().toLowerCase();
    if (normalized === '$eq' || normalized === 'eq' || normalized === '=') return 'equals';
    if (normalized === '$ne' || normalized === 'ne' || normalized === '!=' || normalized === 'is not' || normalized === 'not equal to' || normalized === 'different from') return 'not_equals';
    if (normalized === '$gt' || normalized === 'gt' || normalized === '>' || normalized === 'after' || normalized === 'more than' || normalized === 'more then' || normalized === 'greater than' || normalized === 'greater then') return 'gt';
    if (normalized === '$gte' || normalized === 'gte' || normalized === '>=' || normalized === 'at least' || normalized === 'min') return 'gte';
    if (normalized === '$lt' || normalized === 'lt' || normalized === '<' || normalized === 'before' || normalized === 'less than' || normalized === 'less then') return 'lt';
    if (normalized === '$lte' || normalized === 'lte' || normalized === '<=' || normalized === 'at most' || normalized === 'max') return 'lte';
    if (normalized === '$contains' || normalized === 'contains') return 'contains';
    if (normalized === '$not_contains' || normalized === 'not_contains' || normalized === 'does not contain' || normalized === 'not contains') return 'not_contains';
    if (normalized === '$startswith' || normalized === 'startswith' || normalized === 'starts with') return 'starts_with';
    if (normalized === '$endswith' || normalized === 'endswith' || normalized === 'ends with') return 'ends_with';
    if (normalized === '$in' || normalized === 'in') return 'in';
    if (normalized === '$nin' || normalized === 'nin' || normalized === 'not in') return 'not_in';
    if (normalized === '$between' || normalized === 'between') return 'between';
    return normalized;
}

function extractPostFiltersFromStructuredFilter(rawFilter = {}) {
    if (!rawFilter || typeof rawFilter !== 'object') return [];
    const result = [];
    const collect = (node, joinWithPrevious = 'and') => {
        if (!node || typeof node !== 'object' || Array.isArray(node)) return;
        for (const [field, value] of Object.entries(node)) {
            const logicalOp = String(field || '').trim().toLowerCase();
            if ((logicalOp === '$and' || logicalOp === 'and' || logicalOp === '$or' || logicalOp === 'or') && Array.isArray(value)) {
                const nestedJoin = logicalOp.includes('or') ? 'or' : 'and';
                value.forEach((entry, index) => collect(entry, index === 0 ? joinWithPrevious : nestedJoin));
                continue;
            }

            if (!field || typeof value !== 'object' || value === null || Array.isArray(value)) continue;
            for (const [opKey, opValue] of Object.entries(value)) {
                const operator = normalizeOperatorAlias(opKey);
                if (!opValue && opValue !== 0 && opValue !== false) continue;
                if (operator === 'between') {
                    if (Array.isArray(opValue) && opValue.length >= 2) {
                        result.push({
                            field,
                            operator: 'between',
                            value: stripWrappingQuotes(opValue[0]),
                            valueTo: stripWrappingQuotes(opValue[1]),
                            joinWithPrevious,
                        });
                    }
                    continue;
                }
                if (['equals', 'not_equals', 'contains', 'not_contains', 'starts_with', 'ends_with', 'in', 'not_in', 'gt', 'gte', 'lt', 'lte'].includes(operator)) {
                    result.push({
                        field,
                        operator,
                        value: stripWrappingQuotes(opValue),
                        joinWithPrevious,
                    });
                }
            }
        }
    };
    collect(rawFilter, 'and');
    return result;
}

function parseSelectWindowDirective(prompt, operation = {}) {
    const text = String(prompt || '');
    if (text) {
        // User wording takes precedence over LLM-provided query hints.
        const lastMatch = text.match(SELECT_LAST_RE);
        if (lastMatch) {
            const limit = normalizePositiveLimit(lastMatch[1]);
            if (limit) return { window: 'last', limit };
        }

        const firstMatch = text.match(SELECT_FIRST_RE) || text.match(SELECT_LIMIT_RE);
        if (firstMatch) {
            const limit = normalizePositiveLimit(firstMatch[1]);
            if (limit) return { window: 'first', limit };
        }
    }

    const query = operation && typeof operation.query === 'object' && operation.query !== null
        ? operation.query
        : {};
    const queryWindowRaw = String(query.window || query.slice || query.position || '').trim().toLowerCase();
    const queryLimitRaw = query.limit ?? query.count ?? query.take ?? query.first ?? query.last;
    const queryLimit = normalizePositiveLimit(queryLimitRaw);

    if (queryLimit && (queryWindowRaw === 'first' || queryWindowRaw === 'last')) {
        return { window: queryWindowRaw, limit: queryLimit };
    }
    if (queryLimit && !queryWindowRaw) {
        return { window: 'first', limit: queryLimit };
    }

    return null;
}

function normalizeSelectFilterAndQueryHints(rawFilter = {}) {
    if (!rawFilter || typeof rawFilter !== 'object') {
        return { filter: {}, query: {} };
    }

    const filter = {};
    for (const [key, value] of Object.entries(rawFilter)) {
        if (!isSelectQueryHintKey(key)) {
            filter[key] = value;
        }
    }

    const hintedWindowRaw = String(rawFilter.window || rawFilter.slice || rawFilter.position || '').trim().toLowerCase();
    const hintedLimitRaw = rawFilter.limit ?? rawFilter.count ?? rawFilter.take ?? rawFilter.first ?? rawFilter.last;
    const hintedLimit = normalizePositiveLimit(hintedLimitRaw);

    const query = {};
    if (hintedLimit) {
        query.limit = hintedLimit;
        query.window = hintedWindowRaw === 'last' ? 'last' : 'first';
    }

    return { filter, query };
}

function normalizePostFilters(postFilters = []) {
    if (!Array.isArray(postFilters)) return [];
    return postFilters
        .map(entry => {
            const rawOperator = String(entry?.operator || 'equals').trim().toLowerCase();
            let operator = 'equals';
            operator = normalizeOperatorAlias(rawOperator) || 'equals';
            return {
                field: String(entry?.field || '').trim(),
                operator,
                value: stripWrappingQuotes(entry?.value),
                valueTo: stripWrappingQuotes(entry?.valueTo),
                joinWithPrevious: String(entry?.joinWithPrevious || 'and').trim().toLowerCase(),
            };
        })
        .filter(entry => entry.field && entry.value);
}

function parseComparable(value) {
    if (value === null || value === undefined) return { kind: 'none', value: null };
    if (typeof value === 'number' && Number.isFinite(value)) return { kind: 'number', value };
    const text = String(value).trim();
    if (!text) return { kind: 'none', value: null };
    if (/^-?\d+(?:\.\d+)?$/.test(text)) return { kind: 'number', value: Number(text) };
    const dateValue = new Date(text);
    if (!Number.isNaN(dateValue.getTime())) return { kind: 'date', value: dateValue.getTime() };
    return { kind: 'text', value: text.toLowerCase() };
}

function evaluatePostFilterCondition(record, filter, controller) {
    const actualValue = record?.[filter.field];
    const actualText = String(actualValue ?? '').trim().toLowerCase();
    const expectedText = String(filter.value || '').trim().toLowerCase();
    if (filter.operator === 'contains') return actualText.includes(expectedText);
    if (filter.operator === 'not_contains') return !actualText.includes(expectedText);
    if (filter.operator === 'starts_with') return actualText.startsWith(expectedText);
    if (filter.operator === 'ends_with') return actualText.endsWith(expectedText);
    if (filter.operator === 'equals') return controller.valuesAreEquivalent(actualValue, filter.value);
    if (filter.operator === 'not_equals') return !controller.valuesAreEquivalent(actualValue, filter.value);
    if (filter.operator === 'in' || filter.operator === 'not_in') {
        const options = String(filter.value || '')
            .split(/\s*,\s*|\s+\bor\b\s+/i)
            .map(part => stripWrappingQuotes(part))
            .filter(Boolean);
        if (options.length === 0) return false;
        const inSet = options.some(candidate => controller.valuesAreEquivalent(actualValue, candidate));
        return filter.operator === 'in' ? inSet : !inSet;
    }

    const left = parseComparable(actualValue);
    const right = parseComparable(filter.value);
    if (left.kind === 'none' || right.kind === 'none') return false;
    if ((left.kind === 'date' || right.kind === 'date') && !(left.kind === 'date' && right.kind === 'date')) return false;
    if ((left.kind === 'number' || right.kind === 'number') && !(left.kind === 'number' && right.kind === 'number')) return false;

    const leftValue = left.value;
    const rightValue = right.value;
    if (filter.operator === 'gt') return leftValue > rightValue;
    if (filter.operator === 'gte') return leftValue >= rightValue;
    if (filter.operator === 'lt') return leftValue < rightValue;
    if (filter.operator === 'lte') return leftValue <= rightValue;
    if (filter.operator === 'between') {
        const upper = parseComparable(filter.valueTo);
        if (upper.kind === 'none') return false;
        if (left.kind !== upper.kind) return false;
        const min = rightValue <= upper.value ? rightValue : upper.value;
        const max = rightValue <= upper.value ? upper.value : rightValue;
        return leftValue >= min && leftValue <= max;
    }
    return false;
}

function applyPostFilters(records, postFilters = [], controller) {
    if (!Array.isArray(records) || records.length === 0) return [];
    const normalized = normalizePostFilters(postFilters);
    if (normalized.length === 0) return records;

    return records.filter(record => {
        const groups = [];
        let currentGroup = [];
        for (let index = 0; index < normalized.length; index++) {
            const condition = normalized[index];
            if (index > 0 && condition.joinWithPrevious === 'or') {
                groups.push(currentGroup);
                currentGroup = [];
            }
            currentGroup.push(condition);
        }
        groups.push(currentGroup);

        return groups.some(group =>
            group.every(condition => evaluatePostFilterCondition(record, condition, controller)),
        );
    });
}

function applyExactFilterFallback(controller, records, filter = {}) {
    if (!Array.isArray(records) || records.length === 0) return [];
    if (!filter || typeof filter !== 'object') return records;
    const filterEntries = Object.entries(filter)
        .filter(([, expected]) => !(expected && typeof expected === 'object'));
    if (filterEntries.length === 0) return records;

    return records.filter(record =>
        filterEntries.every(([field, expected]) => {
            if (typeof expected === 'string') {
                const normalizedExpected = expected.trim();
                const notPrefixMatch = normalizedExpected.match(/^not\s+(.+)$/i);
                if (notPrefixMatch) {
                    return !controller.valuesAreEquivalent(record?.[field], notPrefixMatch[1]);
                }
                const notEqualsMatch = normalizedExpected.match(/^!=\s*(.+)$/);
                if (notEqualsMatch) {
                    return !controller.valuesAreEquivalent(record?.[field], notEqualsMatch[1]);
                }
            }
            return controller.valuesAreEquivalent(record?.[field], expected);
        }),
    );
}

export async function handleSelectPagination(controller, prompt, pending, sessionMemory, key) {
    const text = String(prompt || '').trim();
    if (!text) {
        return controller.buildSelectPageResult(
            pending.records || [],
            pending.page || 0,
            pending.pageSize || DEFAULT_SELECTION_PAGE_SIZE,
        );
    }

    if (isNoResponse(prompt) || /^cancel$/i.test(text) || /^(stop|close)$/i.test(text.toLowerCase())) {
        sessionMemory.delete(key);
        return {
            success: true,
            operation: 'SELECT',
            cancelled: true,
            message: 'Pagination closed.',
        };
    }

    const paginationCommand = controller.parseSelectPaginationCommand(prompt);
    if (!paginationCommand) {
        // Non-navigation input should continue as a fresh request.
        sessionMemory.delete(key);
        return null;
    }

    if (paginationCommand === 'all') {
        sessionMemory.delete(key);
        return controller.buildSelectAllResult(pending.records || []);
    }

    const paging = paginateRecords(
        pending.records || [],
        pending.page || 0,
        pending.pageSize || DEFAULT_SELECTION_PAGE_SIZE,
    );

    let nextPage = paging.page;
    if (paginationCommand === 'next' && nextPage < paging.totalPages - 1) nextPage++;
    if (paginationCommand === 'prev' && nextPage > 0) nextPage--;

    pending.page = nextPage;
    pending.pageSize = paging.pageSize;
    sessionMemory.set(key, pending);

    const atBoundary = nextPage === paging.page && paging.totalPages > 1;
    const boundaryMessage = atBoundary
        ? `You're already on ${paginationCommand === 'next' ? 'the last' : 'the first'} page.`
        : '';

    return controller.buildSelectPageResult(
        pending.records || [],
        pending.page,
        pending.pageSize,
        boundaryMessage,
    );
}

/**
 * Check all pending states and handle the user's response.
 * Returns a result if a pending state was found, null otherwise.
 */
export async function handlePendingState(controller, prompt, sessionMemory) {
    // Create confirmation
    const createKey = pendingKey(controller.entityName, PENDING_STATE_SUFFIXES.CREATE);
    const pendingCreate = sessionMemory.get(createKey);
    if (pendingCreate) {
        return controller.handleCreateConfirmation(prompt, pendingCreate, sessionMemory, createKey);
    }

    // Create collision resolution (create -> update fallback)
    const createConflictKey = pendingKey(controller.entityName, PENDING_STATE_SUFFIXES.CREATE_CONFLICT_UPDATE);
    const pendingCreateConflict = sessionMemory.get(createConflictKey);
    if (pendingCreateConflict) {
        return controller.handleCreateConflictUpdateConfirmation(prompt, pendingCreateConflict, sessionMemory, createConflictKey);
    }

    // Create required-field capture
    const createCaptureKey = pendingKey(controller.entityName, PENDING_STATE_SUFFIXES.CREATE_CAPTURE);
    const pendingCreateCapture = sessionMemory.get(createCaptureKey);
    if (pendingCreateCapture) {
        return controller.handleCreateFieldCapture(prompt, pendingCreateCapture, sessionMemory, createCaptureKey);
    }

    // Update confirmation
    const updateKey = pendingKey(controller.entityName, PENDING_STATE_SUFFIXES.UPDATE);
    const pendingUpdate = sessionMemory.get(updateKey);
    if (pendingUpdate) {
        return controller.handleUpdateConfirmation(prompt, pendingUpdate, sessionMemory, updateKey);
    }

    // Update target capture (user must provide primary key to update)
    const updateTargetCaptureKey = pendingKey(controller.entityName, PENDING_STATE_SUFFIXES.UPDATE_TARGET_CAPTURE);
    const pendingUpdateTargetCapture = sessionMemory.get(updateTargetCaptureKey);
    if (pendingUpdateTargetCapture) {
        return controller.handleUpdateTargetCapture(prompt, pendingUpdateTargetCapture, sessionMemory, updateTargetCaptureKey);
    }

    // Update field capture (user is specifying what to change)
    const captureKey = pendingKey(controller.entityName, PENDING_STATE_SUFFIXES.UPDATE_CAPTURE);
    const pendingCapture = sessionMemory.get(captureKey);
    if (pendingCapture) {
        return controller.handleUpdateFieldCapture(prompt, pendingCapture, sessionMemory, captureKey);
    }

    // Delete id capture (user must provide primary key to delete)
    const deleteCaptureKey = pendingKey(controller.entityName, PENDING_STATE_SUFFIXES.DELETE_CAPTURE);
    const pendingDeleteCapture = sessionMemory.get(deleteCaptureKey);
    if (pendingDeleteCapture) {
        return controller.handleDeleteIdCapture(prompt, pendingDeleteCapture, sessionMemory, deleteCaptureKey);
    }

    // Delete confirmation
    const deleteKey = pendingKey(controller.entityName, PENDING_STATE_SUFFIXES.DELETE);
    const pendingDelete = sessionMemory.get(deleteKey);
    if (pendingDelete) {
        return controller.handleDeleteConfirmation(prompt, pendingDelete, sessionMemory, deleteKey);
    }

    // Validation corrections
    const validationKey = pendingKey(controller.entityName, PENDING_STATE_SUFFIXES.VALIDATION);
    const pendingValidation = sessionMemory.get(validationKey);
    if (pendingValidation) {
        return controller.handleValidationCorrections(prompt, pendingValidation, sessionMemory, validationKey);
    }

    // Select pagination (next/prev navigation over large SELECT results)
    const selectPaginationKey = pendingKey(controller.entityName, PENDING_STATE_SUFFIXES.SELECT_PAGINATION);
    const pendingSelectPagination = sessionMemory.get(selectPaginationKey);
    if (pendingSelectPagination) {
        sessionMemory.delete(selectPaginationKey);
    }

    return null;
}

/**
 * Fallback operation parsing when LLM is unavailable.
 * Uses simple pattern matching to determine operation type.
 */
function fallbackOperationParsing(prompt, controller, sessionMemory) {
    const lowerPrompt = prompt.toLowerCase().trim();
    const extractedEntityId = extractEntityIdMention(prompt, controller.entityName);
    
    // First check if there's an ongoing session that should be continued
    if (sessionMemory) {
        // Check for ongoing UPDATE session
        const updateKey = pendingKey(controller.entityName, PENDING_STATE_SUFFIXES.UPDATE);
        const pendingUpdate = sessionMemory.get(updateKey);
        if (pendingUpdate) {
            return {
                operation: 'UPDATE',
                filter: { [controller.primaryKey]: pendingUpdate.id }
            };
        }
        
        // Check for ongoing CREATE session
        const createKey = pendingKey(controller.entityName, PENDING_STATE_SUFFIXES.CREATE);
        const pendingCreate = sessionMemory.get(createKey);
        if (pendingCreate) {
            return { operation: 'CREATE' };
        }
        
        // Check for ongoing DELETE session
        const deleteKey = pendingKey(controller.entityName, PENDING_STATE_SUFFIXES.DELETE);
        const pendingDelete = sessionMemory.get(deleteKey);
        if (pendingDelete) {
            return { operation: 'DELETE' };
        }
    }
    
    // No ongoing session - use keyword matching
    if (CREATE_KEYWORDS.some((keyword) => lowerPrompt.includes(keyword))) {
        return { operation: 'CREATE' };
    }
    
    if (DELETE_KEYWORDS.some((keyword) => lowerPrompt.includes(keyword))) {
        return extractedEntityId
            ? { operation: 'DELETE', filter: { [controller.primaryKey]: extractedEntityId } }
            : { operation: 'DELETE' };
    }
    
    if (UPDATE_KEYWORDS.some((keyword) => lowerPrompt.includes(keyword))) {
        return extractedEntityId
            ? { operation: 'UPDATE', filter: { [controller.primaryKey]: extractedEntityId } }
            : { operation: 'UPDATE' };
    }
    
    // Default to SELECT for listing queries
    return { operation: 'SELECT' };
}

export async function parseOperation(controller, prompt) {
    const fieldInfo = formatFieldInfo(controller.fields);
    const operationPrompt = buildParseOperationPrompt(
        prompt,
        controller.entityName,
        controller.parsedSkill.tablePurpose,
        fieldInfo,
        controller.parsedSkill.instructions || '',
    );

    let parsed;
    try {
        parsed = await controller.llmAgent.executePrompt(operationPrompt, {
            mode: 'fast',
            responseShape: 'json',
        });
    } catch (error) {
        // LLM failed - use fallback heuristics
        console.warn(`LLM operation parsing failed: ${controller.extractErrorMessage(error)}`);
        parsed = fallbackOperationParsing(prompt, controller, controller.sessionMemory);
    }

    let normalizedParsed = parsed && typeof parsed === 'object' ? { ...parsed } : {};
    const parsedOperation = String(normalizedParsed?.operation || '').toUpperCase();
    const promptText = String(prompt || '');

    // Guard against LLM misclassifying explicit listing intents as CREATE/UPDATE.
    if (looksLikeSelectCommand(prompt) && parsedOperation !== 'SELECT') {
        const safeFilter = parsed && typeof parsed.filter === 'object' && parsed.filter !== null
            ? parsed.filter
            : {};
        normalizedParsed = {
            ...normalizedParsed,
            operation: 'SELECT',
            filter: safeFilter,
        };
    }
    if (DELETE_PREFIX_RE.test(promptText) && parsedOperation !== 'DELETE') {
        normalizedParsed = {
            ...normalizedParsed,
            operation: 'DELETE',
        };
    } else if (UPDATE_PREFIX_RE.test(promptText) && parsedOperation !== 'UPDATE' && parsedOperation !== 'DELETE') {
        normalizedParsed = {
            ...normalizedParsed,
            operation: 'UPDATE',
        };
    } else if (CREATE_PREFIX_RE.test(promptText) && parsedOperation !== 'CREATE') {
        normalizedParsed = {
            ...normalizedParsed,
            operation: 'CREATE',
        };
    }

    // Guard against LLM mapping shorthand "change <entity> <id>" to non-PK filters.
    const pkShortcut = extractPrimaryKeyShortcut(prompt, controller.entityName);
    const idMention = extractEntityIdMention(prompt, controller.entityName);
    const normalizedOperation = String(normalizedParsed?.operation || '').toUpperCase();
    if (pkShortcut && (normalizedOperation === 'UPDATE' || normalizedOperation === 'DELETE')) {
        const currentFilter = normalizedParsed && typeof normalizedParsed.filter === 'object' && normalizedParsed.filter !== null
            ? normalizedParsed.filter
            : {};
        const hasPrimaryKey = Object.prototype.hasOwnProperty.call(currentFilter, controller.primaryKey)
            && String(currentFilter[controller.primaryKey] || '').trim() !== '';
        if (!hasPrimaryKey) {
            normalizedParsed = {
                ...normalizedParsed,
                filter: {
                    [controller.primaryKey]: pkShortcut,
                },
            };
        }
    }
    if (idMention && (normalizedOperation === 'UPDATE' || normalizedOperation === 'DELETE')) {
        const currentFilter = normalizedParsed && typeof normalizedParsed.filter === 'object' && normalizedParsed.filter !== null
            ? normalizedParsed.filter
            : {};
        const hasPrimaryKey = Object.prototype.hasOwnProperty.call(currentFilter, controller.primaryKey)
            && String(currentFilter[controller.primaryKey] || '').trim() !== '';
        if (!hasPrimaryKey) {
            normalizedParsed = {
                ...normalizedParsed,
                filter: {
                    [controller.primaryKey]: idMention,
                },
            };
        }
    }

    const finalizedOperation = String(normalizedParsed?.operation || '').toUpperCase();
    if (finalizedOperation === 'SELECT') {
        let currentFilter = normalizedParsed && typeof normalizedParsed.filter === 'object' && normalizedParsed.filter !== null
            ? { ...normalizedParsed.filter }
            : {};
        const hasPrimaryKey = Object.prototype.hasOwnProperty.call(currentFilter, controller.primaryKey)
            && String(currentFilter[controller.primaryKey] || '').trim() !== '';
        if (!hasPrimaryKey) {
            const selectPkShortcut = extractSelectPrimaryKeyShortcut(prompt, controller.entityName);
            const selectPkMention = selectPkShortcut || extractEntityIdMention(prompt, controller.entityName);
            if (selectPkMention) {
                // Prefer explicit "<verb> <entity> <id>" over ambiguous LLM filters.
                currentFilter = {
                    [controller.primaryKey]: selectPkMention,
                };
            }
        }
        const hasFilter = Object.keys(currentFilter).length > 0;
        normalizedParsed = {
            ...normalizedParsed,
            filter: currentFilter,
        };

        const selectCondition = parseSelectConditionFromPrompt(controller, prompt);
        const existingPostFilters = normalizePostFilters(normalizedParsed?.postFilters);

        const mergedPostFilters = [...existingPostFilters];
        if (!hasFilter && selectCondition) {
            mergedPostFilters.push(selectCondition);
        }

        const selectWindow = parseSelectWindowDirective(prompt, normalizedParsed);
        if (selectWindow) {
            normalizedParsed = {
                ...normalizedParsed,
                query: {
                    ...(normalizedParsed?.query && typeof normalizedParsed.query === 'object' ? normalizedParsed.query : {}),
                    window: selectWindow.window,
                    limit: selectWindow.limit,
                },
            };
        }

        if (mergedPostFilters.length > 0) {
            normalizedParsed = {
                ...normalizedParsed,
                postFilters: mergedPostFilters,
            };
        }
    }

    return normalizedParsed;
}

export async function selectFlow(controller, operation, execContext, sessionMemory, prompt = '') {
    const selectPaginationKey = pendingKey(controller.entityName, PENDING_STATE_SUFFIXES.SELECT_PAGINATION);
    const parsedPostFilters = parseSelectConditionsFromPrompt(controller, prompt);
    const rawFilter = operation && typeof operation.filter === 'object' && operation.filter !== null
        ? operation.filter
        : {};
    const structuredPostFilters = extractPostFiltersFromStructuredFilter(rawFilter);
    const normalizedFilterInfo = normalizeSelectFilterAndQueryHints(rawFilter);
    let baseFilter = controller.filterKnownFields(normalizedFilterInfo.filter || {});
    if (parsedPostFilters.length > 0) {
        // If we already extracted deterministic conditions from prompt,
        // avoid conflicting LLM-provided filter blobs (e.g. { quantity: { gte, lte } }).
        const postFilterFields = new Set(parsedPostFilters.map(condition => condition.field));
        baseFilter = Object.fromEntries(
            Object.entries(baseFilter).filter(([field]) => !postFilterFields.has(field)),
        );
    }
    if (structuredPostFilters.length > 0) {
        const structuredFields = new Set(structuredPostFilters.map(condition => condition.field));
        baseFilter = Object.fromEntries(
            Object.entries(baseFilter).filter(([field, value]) =>
                !structuredFields.has(field) || !(value && typeof value === 'object'),
            ),
        );
    }
    let records = await execContext.selectRecords(baseFilter);
    let filteredRecords = Array.isArray(records) ? records : [];
    const hasBaseFilter = Object.keys(baseFilter).length > 0;
    if (filteredRecords.length === 0 && hasBaseFilter) {
        const fallbackRecords = await execContext.selectRecords({});
        filteredRecords = applyExactFilterFallback(
            controller,
            Array.isArray(fallbackRecords) ? fallbackRecords : [],
            baseFilter,
        );
    }

    let postFilters = parsedPostFilters.length > 0
        ? parsedPostFilters
        : normalizePostFilters(operation?.postFilters);
    if (postFilters.length === 0 && structuredPostFilters.length > 0) {
        postFilters = structuredPostFilters;
    }
    if (postFilters.length > 0) {
        filteredRecords = applyPostFilters(filteredRecords, postFilters, controller);
    }

    if (!filteredRecords || filteredRecords.length === 0) {
        if (sessionMemory) {
            sessionMemory.delete(selectPaginationKey);
        }
        return {
            success: true,
            operation: 'SELECT',
            records: [],
            count: 0,
            message: `No ${controller.entityName} records found.`,
        };
    }

    // Present each record
    const presented = await Promise.all(
        filteredRecords.map(record =>
            execContext.presentRecord
                ? execContext.presentRecord(record)
                : record
        ),
    );

    const safePresented = sanitizeRecordsForUser(presented);
    const selectWindow = parseSelectWindowDirective(prompt, {
        ...(operation || {}),
        query: {
            ...(operation?.query && typeof operation.query === 'object' ? operation.query : {}),
            ...(normalizedFilterInfo.query || {}),
        },
    });
    if (sessionMemory) {
        sessionMemory.delete(selectPaginationKey);
    }

    if (selectWindow) {
        const totalCount = safePresented.length;
        const limited = selectWindow.window === 'last'
            ? safePresented.slice(Math.max(totalCount - selectWindow.limit, 0))
            : safePresented.slice(0, selectWindow.limit);

        const table = formatRecordsTable(limited, controller.getListTableFields(), controller.entityName, {
            resolveLabel: (fieldName) => controller.getFieldLabel(fieldName, 'short'),
        });

        return {
            success: true,
            operation: 'SELECT',
            records: limited,
            count: limited.length,
            totalCount,
            requiresInput: false,
            renderRecordsTable: false,
            message: `Found ${totalCount} ${controller.entityName}(s):\n\n${table}\n\nShowing ${selectWindow.window} ${limited.length} ${controller.entityName}(s).`,
        };
    }

    return controller.buildSelectAllResult(safePresented);
}
