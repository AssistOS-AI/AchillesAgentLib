import { QUERY_WEIGHTS, STOPWORDS } from './constants.mjs';

export class AKUTokenizer {
    constructor(options = {}) {
        this.stopwords = options.stopwords ?? STOPWORDS;
    }

    tokenizeField(value, field = 'text') {
        const text = flattenText(value);
        const tokens = [];
        const surfaces = extractSurfaces(text, field);
        for (const surface of surfaces) {
            for (const alias of aliasesFor(surface)) {
                if (!alias || this.stopwords.has(alias)) {
                    continue;
                }
                tokens.push(alias);
            }
        }
        return tokens;
    }

    tokenizeForExact(value) {
        return normalizePhrase(flattenText(value));
    }

    extractAcronyms(value) {
        const text = flattenText(value);
        const matches = text.match(/\b[A-Z][A-Z0-9]{1,}\b/g) ?? [];
        return unique(matches.map(match => match.toLowerCase()));
    }

    tokenizeQuery(query) {
        const queryObject = typeof query === 'string' ? { text: query } : (query ?? {});
        const text = String(queryObject.text ?? queryObject.query ?? '');
        const phrases = extractQuotedPhrases(text).map(phrase => ({
            text: phrase,
            normalized: normalizePhrase(phrase),
            source: 'quoted',
            weight: QUERY_WEIGHTS.phrase,
        }));
        const freeText = text.replace(/"([^"]+)"/g, ' ');
        const explicitKeywords = asArray(queryObject.keyword ?? queryObject.keywords);
        const explicitTags = asArray(queryObject.tag ?? queryObject.tags);
        const keywordPhrases = explicitKeywords
            .filter(value => String(value).trim().includes(' '))
            .map(value => normalizePhrase(value));
        const tagPhrases = explicitTags.map(value => normalizePhrase(value));
        const termMap = new Map();

        const addTerms = (value, weight, source) => {
            for (const term of this.tokenizeField(value, source)) {
                const existing = termMap.get(term);
                if (existing) {
                    existing.weight = Math.max(existing.weight, weight);
                    existing.sources.add(source);
                } else {
                    termMap.set(term, { term, weight, sources: new Set([source]) });
                }
            }
        };

        addTerms(freeText, QUERY_WEIGHTS.text, 'text');
        for (const keyword of explicitKeywords) {
            addTerms(keyword, QUERY_WEIGHTS.keyword, 'keyword');
        }
        for (const tag of explicitTags) {
            addTerms(tag, QUERY_WEIGHTS.tag, 'tag');
        }
        for (const phrase of phrases) {
            addTerms(phrase.text, QUERY_WEIGHTS.phrase, 'phrase');
        }

        return {
            raw: query,
            text,
            freeText,
            terms: [...termMap.values()].map(item => ({
                term: item.term,
                weight: item.weight,
                sources: [...item.sources].sort(),
            })).sort((a, b) => a.term.localeCompare(b.term)),
            phrases,
            keywordPhrases,
            tagPhrases,
            explicitKeywords: explicitKeywords.map(String),
            explicitTags: explicitTags.map(String),
            filters: normalizeQueryFilters(queryObject),
        };
    }
}

export function flattenText(value) {
    if (value === undefined || value === null) {
        return '';
    }
    if (Array.isArray(value)) {
        return value.map(flattenText).filter(Boolean).join(' ');
    }
    if (typeof value === 'object') {
        return Object.values(value).map(flattenText).filter(Boolean).join(' ');
    }
    return String(value);
}

export function normalizePhrase(value) {
    return foldDiacritics(String(value ?? '')
        .normalize('NFKC')
        .toLowerCase())
        .replace(/[^\p{L}\p{N}/_.\-\s]+/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

export function aliasesFor(value) {
    const base = String(value ?? '').normalize('NFKC');
    const lower = base.toLowerCase();
    const folded = foldDiacritics(lower);
    return unique([lower, folded].map(cleanToken).filter(Boolean));
}

export function foldDiacritics(value) {
    return String(value ?? '').normalize('NFD').replace(/\p{M}/gu, '').normalize('NFC');
}

function extractSurfaces(text, field) {
    const rawParts = String(text ?? '').match(/[\p{L}\p{N}][\p{L}\p{N}_./:-]*/gu) ?? [];
    const surfaces = [];
    for (const raw of rawParts) {
        surfaces.push(raw);
        if (field === 'path' && raw.includes('/')) {
            surfaces.push(...pathPrefixes(raw));
        }
        const separated = raw.replace(/[-_./:]+/g, ' ');
        for (const part of separated.split(/\s+/).filter(Boolean)) {
            surfaces.push(part);
            const camel = splitCamel(part);
            surfaces.push(...camel);
        }
    }
    return surfaces;
}

function splitCamel(value) {
    const spaced = String(value)
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
    return spaced.split(/\s+/).filter(Boolean);
}

function pathPrefixes(value) {
    const parts = String(value).split('/').filter(Boolean);
    const prefixes = [];
    for (let index = 1; index <= parts.length; index += 1) {
        prefixes.push(parts.slice(0, index).join('/'));
    }
    return prefixes;
}

function cleanToken(value) {
    return String(value ?? '')
        .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
        .trim();
}

function extractQuotedPhrases(text) {
    const phrases = [];
    const regex = /"([^"]+)"/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
        if (match[1].trim()) {
            phrases.push(match[1].trim());
        }
    }
    return phrases;
}

function asArray(value) {
    if (value === undefined || value === null) {
        return [];
    }
    return Array.isArray(value) ? value : [value];
}

function normalizeQueryFilters(queryObject) {
    const filters = { ...(queryObject.filters ?? {}) };
    const mappings = {
        record_types: 'recordTypes',
        record_type: 'recordType',
        recordTypes: 'recordTypes',
        recordType: 'recordType',
        ku_types: 'kuTypes',
        ku_type: 'kuType',
        kuTypes: 'kuTypes',
        kuType: 'kuType',
        document_types: 'documentTypes',
        document_type: 'documentType',
        documentTypes: 'documentTypes',
        documentType: 'documentType',
        result_types: 'resultTypes',
        result_type: 'resultType',
        resultTypes: 'resultTypes',
        resultType: 'resultType',
        statuses: 'statuses',
        status: 'status',
        excluded_statuses: 'excludedStatuses',
        excluded_status: 'excludedStatus',
        exclude_statuses: 'excludedStatuses',
        exclude_status: 'excludedStatus',
        excludeStatus: 'excludeStatus',
        excludedStatus: 'excludedStatus',
        path_prefix: 'pathPrefix',
        pathPrefix: 'pathPrefix',
        updated_after: 'updatedAfter',
        updatedAfter: 'updatedAfter',
        updated_before: 'updatedBefore',
        updatedBefore: 'updatedBefore',
        created_after: 'createdAfter',
        createdAfter: 'createdAfter',
        created_before: 'createdBefore',
        createdBefore: 'createdBefore',
        timestamp_after: 'timestampAfter',
        timestampAfter: 'timestampAfter',
        timestamp_before: 'timestampBefore',
        timestampBefore: 'timestampBefore',
        ku_ids: 'kuIds',
        ku_id: 'kuId',
        kuIds: 'kuIds',
        kuId: 'kuId',
        include_discarded: 'includeDiscarded',
        includeDiscarded: 'includeDiscarded',
        include_obsolete: 'includeObsolete',
        includeObsolete: 'includeObsolete',
        audit: 'audit',
        recovery: 'recovery',
    };
    for (const [inputKey, outputKey] of Object.entries(mappings)) {
        if (queryObject[inputKey] !== undefined && filters[outputKey] === undefined) {
            filters[outputKey] = queryObject[inputKey];
        }
    }
    return filters;
}

function unique(values) {
    return [...new Set(values)];
}
