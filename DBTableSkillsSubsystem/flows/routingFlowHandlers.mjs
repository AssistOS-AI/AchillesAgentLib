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
const SELECT_FIRST_RE = /\b(?:first|top)\s+([a-z0-9-]+(?:\s+[a-z0-9-]+)*)\b/i;
const SELECT_LAST_RE = /\blast\s+([a-z0-9-]+(?:\s+[a-z0-9-]+)*)\b/i;
const SELECT_LIMIT_RE = /\blimit\s+([a-z0-9-]+(?:\s+[a-z0-9-]+)*)\b/i;
const SELECT_MAX_WINDOW_LIMIT = 1000;
const NUMBER_WORDS_UNITS = new Map([
    ['zero', 0],
    ['one', 1],
    ['two', 2],
    ['three', 3],
    ['four', 4],
    ['five', 5],
    ['six', 6],
    ['seven', 7],
    ['eight', 8],
    ['nine', 9],
    ['ten', 10],
    ['eleven', 11],
    ['twelve', 12],
    ['thirteen', 13],
    ['fourteen', 14],
    ['fifteen', 15],
    ['sixteen', 16],
    ['seventeen', 17],
    ['eighteen', 18],
    ['nineteen', 19],
]);
const NUMBER_WORDS_TENS = new Map([
    ['twenty', 20],
    ['thirty', 30],
    ['forty', 40],
    ['fifty', 50],
    ['sixty', 60],
    ['seventy', 70],
    ['eighty', 80],
    ['ninety', 90],
]);
const NUMBER_WORDS_SCALES = new Map([
    ['hundred', 100],
    ['thousand', 1000],
    ['million', 1000000],
    ['billion', 1000000000],
]);
const NUMBER_WORD_SHORTCUTS = new Map([
    ['couple', 2],
    ['few', 3],
    ['dozen', 12],
]);
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
    const raw = String(value || '').trim();
    if (!raw) return null;
    const parsedNumeric = Number.parseInt(raw, 10);
    if (Number.isFinite(parsedNumeric) && parsedNumeric > 0) {
        return Math.min(parsedNumeric, SELECT_MAX_WINDOW_LIMIT);
    }

    const parsedWords = parseEnglishNumber(raw);
    const parsed = Number.isFinite(parsedWords) ? parsedWords : Number.NaN;
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return Math.min(parsed, SELECT_MAX_WINDOW_LIMIT);
}

function parseEnglishNumber(value) {
    const text = String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, ' ')
        .replace(/-/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    if (!text) return null;

    if (NUMBER_WORD_SHORTCUTS.has(text)) {
        return NUMBER_WORD_SHORTCUTS.get(text);
    }

    const tokens = text.split(' ').filter(Boolean);
    if (tokens.length === 0) return null;

    let total = 0;
    let current = 0;
    let sawToken = false;

    for (const token of tokens) {
        if (token === 'and') continue;

        if (NUMBER_WORD_SHORTCUTS.has(token)) {
            current += NUMBER_WORD_SHORTCUTS.get(token);
            sawToken = true;
            continue;
        }

        if (NUMBER_WORDS_UNITS.has(token)) {
            current += NUMBER_WORDS_UNITS.get(token);
            sawToken = true;
            continue;
        }

        if (NUMBER_WORDS_TENS.has(token)) {
            current += NUMBER_WORDS_TENS.get(token);
            sawToken = true;
            continue;
        }

        if (NUMBER_WORDS_SCALES.has(token)) {
            const scale = NUMBER_WORDS_SCALES.get(token);
            if (scale === 100) {
                current = Math.max(current, 1) * scale;
            } else {
                total += Math.max(current, 1) * scale;
                current = 0;
            }
            sawToken = true;
            continue;
        }

        if (sawToken) {
            break;
        }
        return null;
    }

    if (!sawToken) return null;
    const result = total + current;
    return Number.isFinite(result) ? result : null;
}

function normalizeMetaKey(key) {
    return String(key || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');
}

function hasNumericComparatorCue(prompt = '') {
    const text = String(prompt || '').toLowerCase();
    if (!text.trim()) return false;
    return /\b(at least|at most|less than|less then|more than|more then|greater than|greater then|between|from)\b|>=|<=|(?<![a-z0-9])>(?![=])|(?<![a-z0-9])<(?![=])/i.test(text);
}

function hasInvalidSyntheticFilterKeys(filter = {}) {
    if (!filter || typeof filter !== 'object') return false;
    return Object.keys(filter).some((key) => /_(contains|not_contains|starts_with|ends_with|gt|gte|lt|lte|between|in|not_in)$/i.test(String(key || '')));
}

function hasNumericPostFilter(parsed = {}) {
    const postFilters = Array.isArray(parsed?.postFilters) ? parsed.postFilters : [];
    return postFilters.some((entry) => {
        const op = String(entry?.operator || '').toLowerCase();
        if (!['gt', 'gte', 'lt', 'lte', 'between'].includes(op)) return false;
        const value = String(entry?.value ?? '').trim();
        const valueTo = String(entry?.valueTo ?? '').trim();
        if (op === 'between') {
            return /^-?\d+(\.\d+)?$/.test(value) && /^-?\d+(\.\d+)?$/.test(valueTo);
        }
        return /^-?\d+(\.\d+)?$/.test(value);
    });
}

function hasBulkUpdateCue(prompt = '') {
    const text = String(prompt || '').toLowerCase();
    if (!text.trim()) return false;
    return /\b(move|transfer|reassign|relocate)\b/.test(text) && /\b(all|every|each|bulk)\b/.test(text);
}

function hasUpdateTargeting(parsed = {}) {
    const filter = parsed && typeof parsed.filter === 'object' && parsed.filter !== null ? parsed.filter : {};
    const postFilters = Array.isArray(parsed?.postFilters) ? parsed.postFilters : [];
    return Object.keys(filter).length > 0 || postFilters.length > 0;
}

async function repairUpdateParsingIfNeeded(controller, prompt, parsed) {
    if (!hasBulkUpdateCue(prompt) || hasUpdateTargeting(parsed)) return parsed;

    const fieldInfo = formatFieldInfo(controller.fields);
    const basePrompt = buildParseOperationPrompt(
        prompt,
        controller.entityName,
        controller.parsedSkill.tablePurpose,
        fieldInfo,
        controller.parsedSkill.instructions || '',
    );
    const repairPrompt = `${basePrompt}

Previous parsed JSON is invalid for bulk UPDATE targeting:
${JSON.stringify(parsed || {}, null, 2)}

Repair rules (must follow):
- Operation must stay UPDATE.
- For bulk update cues ("move/transfer/reassign ... all ..."), targeting cannot be empty.
- At least one of these must be present:
  - non-empty "filter" with exact predicates, or
  - non-empty "postFilters" with targeting predicates.
- Never output both empty filter {} and empty postFilters [] for bulk update cues.
- Keep "data" only for fields that are changed by the request.
- If prompt includes a descriptor phrase (example: "Electrical Conduit"), include it in targeting (filter or postFilters).
- If prompt includes "from X to Y", use source in targeting and destination in data.`;

    try {
        let candidate = parsed;
        for (let attempt = 0; attempt < 2; attempt++) {
            const repaired = await controller.llmAgent.executePrompt(repairPrompt, {
                mode: 'code',
                responseShape: 'json',
            });
            candidate = repaired && typeof repaired === 'object' ? repaired : candidate;
            if (hasUpdateTargeting(candidate)) return candidate;
        }
        return candidate;
    } catch (error) {
        return parsed;
    }
}

async function repairSelectParsingIfNeeded(controller, prompt, parsed) {
    const needsNumericComparator = hasNumericComparatorCue(prompt);
    const hasNumeric = hasNumericPostFilter(parsed);
    const hasSynthetic = hasInvalidSyntheticFilterKeys(parsed?.filter || {});
    if (!needsNumericComparator && !hasSynthetic) return parsed;
    if (needsNumericComparator && hasNumeric && !hasSynthetic) return parsed;

    const fieldInfo = formatFieldInfo(controller.fields);
    const numericCandidates = getNumericFieldCandidates(controller);
    const basePrompt = buildParseOperationPrompt(
        prompt,
        controller.entityName,
        controller.parsedSkill.tablePurpose,
        fieldInfo,
        controller.parsedSkill.instructions || '',
    );
    const repairPrompt = `${basePrompt}

Previous parsed JSON was invalid for SELECT constraints:
${JSON.stringify(parsed || {}, null, 2)}

Repair rules (must follow):
- Operation must stay SELECT.
- If prompt has numeric comparator cues, include at least one numeric comparator in postFilters (gt/gte/lt/lte/between).
- Do NOT use synthetic keys in filter (e.g. name_contains, quantity_gte).
- Keep filter as exact equality only, and move comparator logic into postFilters.
- Numeric comparator must target one of these numeric fields (when available): ${numericCandidates.length > 0 ? numericCandidates.join(', ') : '(none detected)'}.
- If numeric fields are available, NEVER drop numeric comparator intent.
- If prompt contains an item phrase + comparator, include BOTH:
  - one text postFilter (contains) for item phrase, and
  - one numeric comparator postFilter (typically quantity).
- Never output only {"filter":{"unit":"pieces"}} when comparator cues exist.
- If unsure, prioritize preserving numeric comparator intent in postFilters over unit equality inference.`;

    try {
        let candidate = parsed;
        for (let attempt = 0; attempt < 2; attempt++) {
            const repaired = await controller.llmAgent.executePrompt(repairPrompt, {
                mode: 'code',
                responseShape: 'json',
            });
            candidate = repaired && typeof repaired === 'object' ? repaired : candidate;
            const repairedHasSynthetic = hasInvalidSyntheticFilterKeys(candidate?.filter || {});
            const repairedHasNumeric = hasNumericPostFilter(candidate);
            if (!repairedHasSynthetic && (!needsNumericComparator || repairedHasNumeric)) {
                return candidate;
            }
        }
        return candidate;
    } catch (error) {
        return parsed;
    }
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

function getFieldType(controller, fieldName) {
    const fieldDef = controller?.fields?.[fieldName] || {};
    return String(fieldDef?.type || '').trim().toLowerCase();
}

function getNumericFieldCandidates(controller) {
    const fields = Object.keys(controller?.fields || {});
    const byType = fields.filter(fieldName => {
        const type = getFieldType(controller, fieldName);
        return type === 'integer' || type === 'decimal' || type === 'bigint' || type === 'number';
    });
    if (byType.length > 0) return byType.filter(field => field !== controller.primaryKey);

    return fields.filter(fieldName =>
        fieldName !== controller.primaryKey && /(quantity|qty|count|amount|number|num|total|size|length|width|height|weight|price|cost|age|year|score|rank|volume|stock)/i.test(fieldName),
    );
}

function scoreFieldAsNumeric(controller, fieldName, records = []) {
    const sample = Array.isArray(records) ? records.slice(0, 100) : [];
    if (sample.length === 0) return 0;
    let numericHits = 0;
    for (const row of sample) {
        const comparable = parseComparable(row?.[fieldName]);
        if (comparable.kind === 'number') numericHits += 1;
    }
    return numericHits / sample.length;
}

function rankNumericFieldCandidates(controller, fields = [], records = []) {
    const weighted = fields.map(fieldName => {
        const nameBonus = /(quantity|qty|count|amount|total|stock|num|number)/i.test(fieldName) ? 0.25 : 0;
        const numericRatio = scoreFieldAsNumeric(controller, fieldName, records);
        return {
            fieldName,
            score: numericRatio + nameBonus,
        };
    });
    return weighted
        .sort((a, b) => b.score - a.score)
        .map(entry => entry.fieldName);
}

function getTextFieldCandidates(controller) {
    const fields = Object.keys(controller?.fields || {});
    const byType = fields.filter(fieldName => {
        const type = getFieldType(controller, fieldName);
        return !type || type === 'string' || type === 'text' || type === 'email' || type === 'url';
    });
    return byType.filter(field => field !== controller.primaryKey);
}

function parseNumericComparatorFromPrompt(prompt = '') {
    const text = String(prompt || '').trim();
    if (!text) return null;

    const betweenMatch = text.match(/\b(?:between|from)\s*(-?\d+(?:\.\d+)?)\s*(?:and|to)\s*(-?\d+(?:\.\d+)?)/i);
    if (betweenMatch) {
        return {
            operator: 'between',
            value: betweenMatch[1],
            valueTo: betweenMatch[2],
        };
    }

    const rules = [
        { regex: /\b(?:at least|minimum of|no less than)\s*(-?\d+(?:\.\d+)?)/i, operator: 'gte' },
        { regex: /\b(?:at most|maximum of|no more than)\s*(-?\d+(?:\.\d+)?)/i, operator: 'lte' },
        { regex: /\b(?:more than|more then|greater than|greater then|over)\s*(-?\d+(?:\.\d+)?)/i, operator: 'gt' },
        { regex: /\b(?:less than|less then|under|below)\s*(-?\d+(?:\.\d+)?)/i, operator: 'lt' },
        { regex: />=\s*(-?\d+(?:\.\d+)?)/, operator: 'gte' },
        { regex: /<=\s*(-?\d+(?:\.\d+)?)/, operator: 'lte' },
        { regex: /(?<![a-z0-9])>(?![=])\s*(-?\d+(?:\.\d+)?)/i, operator: 'gt' },
        { regex: /(?<![a-z0-9])<(?![=])\s*(-?\d+(?:\.\d+)?)/i, operator: 'lt' },
    ];

    for (const rule of rules) {
        const match = text.match(rule.regex);
        if (match) {
            return {
                operator: rule.operator,
                value: match[1],
            };
        }
    }

    return null;
}

function extractSubjectPhraseForSelect(controller, prompt = '') {
    const text = String(prompt || '').trim();
    if (!text) return '';

    const segment = text.split(/\b(?:where|with)\b/i)[0] || '';
    if (!segment.trim()) return '';

    const entityName = String(controller?.entityName || '').trim();
    let normalized = segment
        .replace(/^[\s"'`]+|[\s"'`]+$/g, '')
        .replace(/\b(?:show|list|find|get|display|fetch|give|return)\b/gi, ' ')
        .replace(/\b(?:all|the|any|every)\b/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    if (entityName) {
        const singular = entityName.replace(/s$/i, '');
        const plural = singular.endsWith('s') ? singular : `${singular}s`;
        const entityRe = new RegExp(`\\b(?:${singular}|${plural})\\b`, 'ig');
        normalized = normalized.replace(entityRe, ' ').replace(/\s+/g, ' ').trim();
    }

    return normalized;
}

function inferSubjectContainsCondition(controller, prompt, records = []) {
    const subjectPhrase = extractSubjectPhraseForSelect(controller, prompt);
    if (!subjectPhrase) return null;

    const normalizedPhrase = controller.normalizeTextForComparison(subjectPhrase);
    if (!normalizedPhrase || normalizedPhrase.length < 2) return null;
    const tokens = normalizedPhrase.split(/\s+/).filter(token => token.length >= 2);
    if (tokens.length === 0) return null;

    const textFields = getTextFieldCandidates(controller);
    if (textFields.length === 0) return null;

    const sample = Array.isArray(records) ? records : [];
    let bestField = null;
    let bestScore = 0;

    for (const field of textFields) {
        let score = 0;
        for (const row of sample) {
            const hay = controller.normalizeTextForComparison(row?.[field]);
            if (!hay) continue;
            if (hay.includes(normalizedPhrase)) {
                score += 3;
                continue;
            }
            const matchedTokens = tokens.filter(token => hay.includes(token)).length;
            score += matchedTokens;
        }
        if (score > bestScore) {
            bestScore = score;
            bestField = field;
        }
    }

    if (!bestField) return null;
    return {
        field: bestField,
        operator: 'contains',
        value: subjectPhrase,
        joinWithPrevious: 'and',
    };
}

function getEnumFieldCandidates(controller) {
    return Object.entries(controller?.fields || {})
        .filter(([, field]) => Array.isArray(field?.enumValues) && field.enumValues.length > 0)
        .map(([fieldName]) => fieldName);
}

function normalizeEnumToken(controller, value) {
    return controller.normalizeTextForComparison(String(value || '').trim());
}

function extractSelectFallbackValueCandidates(controller, prompt = '') {
    const values = [];
    const whereClause = stripWrappingQuotes(parseWhereClauseFromPrompt(prompt));
    if (whereClause) {
        values.push(whereClause);
    }

    const subjectPhrase = stripWrappingQuotes(extractSubjectPhraseForSelect(controller, prompt));
    if (subjectPhrase) {
        values.push(subjectPhrase);
    }

    return [...new Set(values
        .map(value => String(value || '').trim())
        .filter(Boolean))];
}

function inferEnumSelectFallbackPostFilters(controller, prompt = '') {
    const enumFields = getEnumFieldCandidates(controller);
    if (enumFields.length === 0) return [];

    const candidates = extractSelectFallbackValueCandidates(controller, prompt);
    if (candidates.length === 0) return [];

    for (const candidate of candidates) {
        const normalizedCandidate = normalizeEnumToken(controller, candidate);
        if (!normalizedCandidate) continue;

        const matches = [];
        for (const fieldName of enumFields) {
            const enumValues = controller?.fields?.[fieldName]?.enumValues || [];
            const matchedValue = enumValues.find((value) =>
                normalizeEnumToken(controller, value) === normalizedCandidate,
            );
            if (matchedValue) {
                matches.push({ fieldName, value: matchedValue });
            }
        }

        if (matches.length > 0) {
            return matches.map((match, index) => ({
                field: match.fieldName,
                operator: 'equals',
                value: match.value,
                joinWithPrevious: index === 0 ? 'and' : 'or',
            }));
        }
    }

    return [];
}

function inferBroadTextSearchFallbackPostFilters(controller, prompt = '', records = []) {
    const candidates = extractSelectFallbackValueCandidates(controller, prompt);
    if (candidates.length === 0) return [];

    const textFields = getTextFieldCandidates(controller);
    if (textFields.length === 0) return [];

    const sample = Array.isArray(records) ? records : [];
    for (const candidate of candidates) {
        const normalizedCandidate = controller.normalizeTextForComparison(candidate);
        if (!normalizedCandidate || normalizedCandidate.length < 2) continue;

        const matchingFields = textFields.filter((fieldName) =>
            sample.some((row) => {
                const hay = controller.normalizeTextForComparison(row?.[fieldName]);
                return hay.includes(normalizedCandidate);
            }),
        );

        if (matchingFields.length > 0) {
            return matchingFields.map((fieldName, index) => ({
                field: fieldName,
                operator: 'contains',
                value: candidate,
                joinWithPrevious: index === 0 ? 'and' : 'or',
            }));
        }
    }

    return [];
}

function mergeAmbiguousSelectFallbackPostFilters(enumFilters = [], textFilters = []) {
    const merged = [];
    const seen = new Set();
    for (const filter of [...enumFilters, ...textFilters]) {
        const key = `${filter.field}::${filter.operator}::${String(filter.value || '')}`;
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(filter);
    }
    return merged.map((filter, index) => ({
        ...filter,
        joinWithPrevious: index === 0 ? 'and' : 'or',
    }));
}

function inferGenericSelectFallbackPostFilters(controller, prompt, records = []) {
    if (!hasNumericComparatorCue(prompt)) return [];

    const comparator = parseNumericComparatorFromPrompt(prompt);
    if (!comparator) return [];

    const numericFields = rankNumericFieldCandidates(
        controller,
        getNumericFieldCandidates(controller),
        records,
    );
    if (numericFields.length === 0) return [];

    const numericCondition = {
        field: numericFields[0],
        operator: comparator.operator,
        value: comparator.value,
        ...(comparator.valueTo ? { valueTo: comparator.valueTo } : {}),
        joinWithPrevious: 'and',
    };

    const subjectCondition = inferSubjectContainsCondition(controller, prompt, records);
    if (!subjectCondition) return [numericCondition];

    return [
        { ...subjectCondition, joinWithPrevious: 'and' },
        { ...numericCondition, joinWithPrevious: 'and' },
    ];
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
    const intent = String(operation?.intent || '').trim().toLowerCase();
    const queryExplicit = query.explicit === true
        || query.explicitWindow === true
        || query.requested === true;
    const queryWindowRaw = String(query.window || query.slice || query.position || '').trim().toLowerCase();
    const queryLimitRaw = query.limit ?? query.count ?? query.take ?? query.first ?? query.last;
    const queryLimit = normalizePositiveLimit(queryLimitRaw);
    const hasExplicitWindowIntent = queryExplicit || intent.includes('(windowed)');

    if (!hasExplicitWindowIntent) {
        return null;
    }

    if (queryLimit && (queryWindowRaw === 'first' || queryWindowRaw === 'last')) {
        return { window: queryWindowRaw, limit: queryLimit };
    }
    if (queryLimit && !queryWindowRaw) {
        return { window: 'first', limit: queryLimit };
    }

    return null;
}

function normalizeEquipmentIdForSort(value) {
    const raw = String(value ?? '').trim().toUpperCase();
    const match = raw.match(/^CRL-?(\d+)$/i);
    if (!match) {
        return { numeric: Number.POSITIVE_INFINITY, normalized: raw };
    }
    return {
        numeric: Number.parseInt(match[1], 10),
        normalized: `CRL-${match[1]}`,
    };
}

function sortEquipmentRecordsAscending(records, controller) {
    if (!Array.isArray(records) || records.length <= 1) {
        return records;
    }

    const entityName = String(controller?.entityName || '').toLowerCase();
    const primaryKey = String(controller?.primaryKey || '').toLowerCase();
    const isEquipmentContext = entityName === 'equipment' || primaryKey === 'equipment_id';
    if (!isEquipmentContext) {
        return records;
    }

    const idField = records.some((record) => Object.prototype.hasOwnProperty.call(record || {}, 'equipment_id'))
        ? 'equipment_id'
        : controller?.primaryKey || 'equipment_id';

    return [...records].sort((left, right) => {
        const leftKey = normalizeEquipmentIdForSort(left?.[idField]);
        const rightKey = normalizeEquipmentIdForSort(right?.[idField]);
        if (leftKey.numeric !== rightKey.numeric) {
            return leftKey.numeric - rightKey.numeric;
        }
        return leftKey.normalized.localeCompare(rightKey.normalized);
    });
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
            let value = stripWrappingQuotes(entry?.value);
            let valueTo = stripWrappingQuotes(entry?.valueTo);

            if (['gt', 'gte', 'lt', 'lte', 'between'].includes(operator)) {
                const leftMatch = String(value || '').match(/-?\d+(?:\.\d+)?/);
                if (leftMatch) value = leftMatch[0];
                if (operator === 'between') {
                    const rightMatch = String(valueTo || '').match(/-?\d+(?:\.\d+)?/);
                    if (rightMatch) valueTo = rightMatch[0];
                }
            }
            return {
                field: String(entry?.field || '').trim(),
                operator,
                value,
                valueTo,
                joinWithPrevious: String(entry?.joinWithPrevious || 'and').trim().toLowerCase(),
            };
        })
        .filter(entry => entry.field && entry.value);
}

function hasNumericComparatorPostFilter(postFilters = []) {
    const normalized = normalizePostFilters(postFilters);
    return normalized.some((entry) => {
        const op = String(entry?.operator || '').toLowerCase();
        if (!['gt', 'gte', 'lt', 'lte', 'between'].includes(op)) return false;
        const left = String(entry?.value || '').trim();
        const right = String(entry?.valueTo || '').trim();
        if (op === 'between') return /^-?\d+(\.\d+)?$/.test(left) && /^-?\d+(\.\d+)?$/.test(right);
        return /^-?\d+(\.\d+)?$/.test(left);
    });
}

function hasExplicitOrCue(prompt = '') {
    const text = String(prompt || '').toLowerCase();
    if (!text.trim()) return false;
    return /\bor\b/.test(text);
}

function enforceConjunctiveNumericIntent(postFilters = [], prompt = '') {
    const normalized = normalizePostFilters(postFilters);
    if (normalized.length < 2) return normalized;
    if (!hasNumericComparatorCue(prompt)) return normalized;
    if (hasExplicitOrCue(prompt)) return normalized;

    const hasNumeric = normalized.some(entry => ['gt', 'gte', 'lt', 'lte', 'between'].includes(String(entry?.operator || '').toLowerCase()));
    const hasText = normalized.some(entry => ['contains', 'not_contains', 'starts_with', 'ends_with', 'equals', 'not_equals', 'in', 'not_in'].includes(String(entry?.operator || '').toLowerCase()));
    if (!hasNumeric || !hasText) return normalized;

    return normalized.map((entry, index) => ({
        ...entry,
        joinWithPrevious: index === 0 ? 'and' : 'and',
    }));
}

function isNumericComparatorOperator(operator = '') {
    return ['gt', 'gte', 'lt', 'lte', 'between'].includes(String(operator || '').toLowerCase());
}

function isPositiveTextOperator(operator = '') {
    return ['contains', 'starts_with', 'ends_with', 'equals', 'in'].includes(String(operator || '').toLowerCase());
}

function evaluateConditionOnField(record, condition, controller, fieldName) {
    return evaluatePostFilterCondition(record, { ...condition, field: fieldName }, controller);
}

function applySemanticTextExpansionWithNumeric(records, postFilters = [], controller) {
    if (!Array.isArray(records) || records.length === 0) return [];
    const normalized = normalizePostFilters(postFilters);
    if (normalized.length === 0) return [];

    const numericConditions = normalized.filter(condition => isNumericComparatorOperator(condition.operator));
    const textConditions = normalized.filter(condition => isPositiveTextOperator(condition.operator));
    if (numericConditions.length === 0 || textConditions.length === 0) return [];

    const textFields = getTextFieldCandidates(controller);
    if (textFields.length === 0) return [];

    const conditionToFields = textConditions.map(condition => {
        const matchingFields = textFields.filter(fieldName =>
            records.some(record => evaluateConditionOnField(record, condition, controller, fieldName)),
        );
        if (matchingFields.length === 0) return [condition.field].filter(Boolean);
        return matchingFields;
    });

    return records.filter(record => {
        const numericOk = numericConditions.every(condition => evaluatePostFilterCondition(record, condition, controller));
        if (!numericOk) return false;

        const textOk = textConditions.every((condition, index) => {
            const candidateFields = conditionToFields[index] || [];
            if (candidateFields.length === 0) return false;
            return candidateFields.some(fieldName => evaluateConditionOnField(record, condition, controller, fieldName));
        });
        return textOk;
    });
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
    let llmUnavailable = false;
    try {
        parsed = await controller.llmAgent.executePrompt(operationPrompt, {
            mode: hasNumericComparatorCue(prompt) ? 'code' : 'fast',
            responseShape: 'json',
        });
    } catch (error) {
        // LLM failed - use fallback heuristics
        console.warn(`LLM operation parsing failed: ${controller.extractErrorMessage(error)}`);
        llmUnavailable = true;
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
        normalizedParsed = await repairSelectParsingIfNeeded(controller, prompt, normalizedParsed);
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

        const selectCondition = llmUnavailable ? parseSelectConditionFromPrompt(controller, prompt) : null;
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
    if (finalizedOperation === 'UPDATE') {
        normalizedParsed = await repairUpdateParsingIfNeeded(controller, prompt, normalizedParsed);
    }

    normalizedParsed.__llmUnavailable = llmUnavailable;

    return normalizedParsed;
}

export async function selectFlow(controller, operation, execContext, sessionMemory, prompt = '') {
    const selectPaginationKey = pendingKey(controller.entityName, PENDING_STATE_SUFFIXES.SELECT_PAGINATION);
    const llmUnavailable = Boolean(operation?.__llmUnavailable);
    const parsedPostFilters = llmUnavailable ? parseSelectConditionsFromPrompt(controller, prompt) : [];
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
    if (postFilters.length === 0 && !llmUnavailable) {
        const promptPostFilters = parseSelectConditionsFromPrompt(controller, prompt);
        if (promptPostFilters.length > 0) {
            postFilters = promptPostFilters;
        }
    }
    if (postFilters.length === 0) {
        const enumFallbackPostFilters = inferEnumSelectFallbackPostFilters(controller, prompt);
        const textSearchFallbackPostFilters = inferBroadTextSearchFallbackPostFilters(controller, prompt, filteredRecords);
        const mergedFallbackPostFilters = mergeAmbiguousSelectFallbackPostFilters(
            enumFallbackPostFilters,
            textSearchFallbackPostFilters,
        );
        if (mergedFallbackPostFilters.length > 0) {
            postFilters = mergedFallbackPostFilters;
        }
    }
    if (llmUnavailable && postFilters.length === 0) {
        const inferredFallbackPostFilters = inferGenericSelectFallbackPostFilters(controller, prompt, filteredRecords);
        if (inferredFallbackPostFilters.length > 0) {
            postFilters = inferredFallbackPostFilters;
        }
    }
    postFilters = enforceConjunctiveNumericIntent(postFilters, prompt);
    if (hasNumericComparatorCue(prompt) && !hasNumericComparatorPostFilter(postFilters)) {
        if (sessionMemory) {
            sessionMemory.delete(selectPaginationKey);
        }
        return {
            success: false,
            operation: 'SELECT',
            message: `Could not safely apply numeric comparator from prompt. Please specify explicit numeric field (e.g. "quantity > 50").`,
        };
    }
    if (postFilters.length > 0) {
        filteredRecords = applyPostFilters(filteredRecords, postFilters, controller);
        if (filteredRecords.length === 0 && hasNumericComparatorCue(prompt)) {
            const expanded = applySemanticTextExpansionWithNumeric(records, postFilters, controller);
            if (expanded.length > 0) {
                filteredRecords = expanded;
            }
        }
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
    const orderedPresented = sortEquipmentRecordsAscending(safePresented, controller);
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
        const totalCount = orderedPresented.length;
        const limited = selectWindow.window === 'last'
            ? orderedPresented.slice(Math.max(totalCount - selectWindow.limit, 0))
            : orderedPresented.slice(0, selectWindow.limit);

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

    return controller.buildSelectAllResult(orderedPresented);
}
