import {
    BM25F_DEFAULTS,
    DEFAULT_EXCLUDED_STATUSES,
    EXACT_BOOSTS,
    RECORD_TYPE_PREFERENCE,
    RECENCY_MODIFIERS,
    SEARCH_DEFAULTS,
    SEARCH_FIELDS,
    STATUS_MODIFIERS,
} from './constants.mjs';
import { normalizePhrase } from './tokenizer.mjs';

export class AKUSearchIndex {
    constructor(options = {}) {
        this.tokenizer = options.tokenizer;
        this.records = [];
        this.stats = null;
        this.postings = new Map();
        this.recordBySearchId = new Map();
        this.scorer = new BM25FScorer();
        this.exactScorer = new ExactMatchScorer();
    }

    load(records = [], stats = {}) {
        this.stats = stats;
        this.records = records.map((record, ordinal) => prepareRecord(record, ordinal, this.tokenizer));
        this.recordBySearchId = new Map(this.records.map(record => [record.search_id, record]));
        this.postings = buildPostings(this.records);
        return this;
    }

    getRecord(searchId) {
        return this.recordBySearchId.get(searchId) ?? null;
    }

    candidateOrdinals(queryModel) {
        if (!queryModel.terms.length) {
            return this.records.map((_, ordinal) => ordinal);
        }
        const ordinals = new Set();
        for (const { term } of queryModel.terms) {
            const postings = this.postings.get(term);
            if (!postings) {
                continue;
            }
            for (const ordinal of postings) {
                ordinals.add(ordinal);
            }
        }
        return [...ordinals].sort((a, b) => a - b);
    }

    search(queryModel, options = {}) {
        const filter = new FilterCompiler().compile(queryModel, options);
        const candidateOrdinals = new Set(this.candidateOrdinals(queryModel));

        if (hasExplicitPhrase(queryModel)) {
            for (const record of this.records) {
                if (!filter.matches(record)) {
                    continue;
                }
                if (this.exactScorer.hasAnyExplicitPhrase(record, queryModel)) {
                    candidateOrdinals.add(record.__ordinal);
                }
            }
        }

        if (!queryModel.terms.length && !hasExplicitPhrase(queryModel)) {
            for (const record of this.records) {
                candidateOrdinals.add(record.__ordinal);
            }
        }

        const scored = [];
        const nowMs = options.now ? Date.parse(options.now) : Date.now();
        for (const ordinal of candidateOrdinals) {
            const record = this.records[ordinal];
            if (!record || !filter.matches(record)) {
                continue;
            }
            const bm25f = this.scorer.score(record, queryModel, this.stats);
            const lexical = bm25f / (1 + bm25f);
            const exact = this.exactScorer.score(record, queryModel);
            const statusModifier = statusModifierFor(record);
            const recencyModifier = recencyModifierFor(record, nowMs);
            const final = lexical + exact.bonus + statusModifier + recencyModifier;
            const matchedOn = [
                ...exact.matchedOn,
                ...queryModel.terms
                    .filter(term => record.__tokenSet.has(term.term))
                    .map(term => `term:${term.term}`),
            ];
            scored.push({
                ...publicRecord(record),
                score: Number(final.toFixed(6)),
                matched_on: [...new Set(matchedOn)].sort(),
                __sort: {
                    final,
                    exactHitCount: exact.hitCount,
                    statusStrength: statusStrength(record.status),
                    updatedMs: record.__updatedMs,
                    typePreference: RECORD_TYPE_PREFERENCE[record.record_type] ?? 0,
                },
                score_components: options.explain ? {
                    bm25f: Number(bm25f.toFixed(6)),
                    lexical: Number(lexical.toFixed(6)),
                    exact_bonus: Number(exact.bonus.toFixed(6)),
                    status_modifier: statusModifier,
                    recency_modifier: recencyModifier,
                    final: Number(final.toFixed(6)),
                    exact_hits: exact.hits,
                } : undefined,
            });
        }

        scored.sort(compareResults);
        const diversified = applyDiversity(scored, options.maxResultsPerKU ?? SEARCH_DEFAULTS.maxResultsPerKU);
        const limit = options.limit ?? SEARCH_DEFAULTS.limit;
        const results = diversified.slice(0, limit).map(({ __sort, ...result }) => {
            if (!options.explain) {
                delete result.score_components;
            }
            return result;
        });
        return {
            query: queryModel.raw,
            total: scored.length,
            results,
        };
    }
}

export class BM25FScorer {
    score(record, queryModel, stats = {}) {
        const recordCount = stats.record_count || record.__recordCount || 1;
        const documentFrequency = stats.document_frequency ?? {};
        const avgFieldLengths = stats.avg_field_lengths ?? {};
        let total = 0;

        for (const queryTerm of queryModel.terms) {
            const term = queryTerm.term;
            const df = Math.max(0, documentFrequency[term] ?? 0);
            if (df <= 0) {
                continue;
            }
            const idf = Math.log(1 + ((recordCount - df + 0.5) / (df + 0.5)));
            let combinedEvidence = 0;
            for (const field of SEARCH_FIELDS) {
                const tokens = record.__fieldTokens[field] ?? [];
                const tf = countTerm(tokens, term);
                if (tf <= 0) {
                    continue;
                }
                const weight = BM25F_DEFAULTS.fieldWeights[field] ?? 1;
                const b = BM25F_DEFAULTS.fieldB[field] ?? 0;
                const fieldLength = Math.max(1, record.__fieldLengths[field] ?? 0);
                const averageLength = Math.max(1, avgFieldLengths[field] ?? fieldLength);
                const norm = (1 - b) + b * (fieldLength / averageLength);
                combinedEvidence += weight * (tf / norm);
            }
            if (combinedEvidence <= 0) {
                continue;
            }
            const saturated = ((BM25F_DEFAULTS.k1 + 1) * combinedEvidence)
                / (BM25F_DEFAULTS.k1 + combinedEvidence);
            total += queryTerm.weight * idf * saturated;
        }

        return total;
    }
}

export class ExactMatchScorer {
    score(record, queryModel) {
        const hits = [];
        let bonus = 0;
        const add = (kind, value, amount) => {
            if (bonus >= EXACT_BOOSTS.cap) {
                return;
            }
            hits.push({ kind, value, amount });
            bonus = Math.min(EXACT_BOOSTS.cap, bonus + amount);
        };

        for (const phrase of queryModel.keywordPhrases) {
            if (record.__exact.keywords.includes(phrase)) {
                add('keyword_phrase', phrase, EXACT_BOOSTS.keywordPhrase);
            }
        }
        for (const tag of queryModel.tagPhrases) {
            if (record.__exact.tags.includes(tag)) {
                add('tag', tag, EXACT_BOOSTS.tag);
            }
        }
        for (const phrase of queryModel.phrases) {
            if (phrase.normalized && record.__exact.allText.includes(phrase.normalized)) {
                add('quoted_phrase', phrase.normalized, EXACT_BOOSTS.quotedPhrase);
            }
            if (phrase.normalized && record.__exact.title.includes(phrase.normalized)) {
                add('title_phrase', phrase.normalized, EXACT_BOOSTS.titlePhrase);
            }
            if (phrase.normalized && record.__exact.reusable.includes(phrase.normalized)) {
                add('reusable_finding_phrase', phrase.normalized, EXACT_BOOSTS.reusableFindingPhrase);
            }
        }
        for (const keyword of queryModel.explicitKeywords.map(normalizePhrase)) {
            if (keyword && record.__exact.keywords.includes(keyword)) {
                add('keyword_phrase', keyword, EXACT_BOOSTS.keywordPhrase);
            }
        }
        for (const tag of queryModel.explicitTags.map(normalizePhrase)) {
            if (tag && record.__exact.tags.includes(tag)) {
                add('tag', tag, EXACT_BOOSTS.tag);
            }
        }
        const freeNeedles = [
            ...queryModel.explicitKeywords.map(normalizePhrase),
            ...queryModel.explicitTags.map(normalizePhrase),
        ].filter(Boolean);
        for (const needle of freeNeedles) {
            if (record.__exact.type === needle) {
                add('type', needle, EXACT_BOOSTS.type);
            }
            if (record.__exact.path.includes(needle)) {
                add('path_substring', needle, EXACT_BOOSTS.pathSubstring);
            }
            if (record.__exact.acronyms.includes(needle)) {
                add('acronym', needle, EXACT_BOOSTS.acronym);
            }
        }

        return {
            bonus,
            hitCount: hits.length,
            hits,
            matchedOn: hits.map(hit => `${hit.kind}:${hit.value}`),
        };
    }

    hasAnyExplicitPhrase(record, queryModel) {
        const phrases = [
            ...queryModel.phrases.map(phrase => phrase.normalized),
            ...queryModel.keywordPhrases,
        ].filter(Boolean);
        return phrases.some(phrase => record.__exact.allText.includes(phrase));
    }
}

export class FilterCompiler {
    compile(queryModel, options = {}) {
        const filters = {
            ...(queryModel.filters ?? {}),
            ...(options.filters ?? {}),
        };
        for (const key of [
            'recordType',
            'recordTypes',
            'record_type',
            'record_types',
            'kuType',
            'kuTypes',
            'ku_type',
            'ku_types',
            'documentType',
            'documentTypes',
            'document_type',
            'document_types',
            'resultType',
            'resultTypes',
            'result_type',
            'result_types',
            'fileType',
            'fileTypes',
            'file_type',
            'file_types',
            'linkRelation',
            'linkRelations',
            'link_relation',
            'link_relations',
            'status',
            'statuses',
            'excludeStatus',
            'excludedStatus',
            'excludedStatuses',
            'excluded_status',
            'excluded_statuses',
            'exclude_status',
            'exclude_statuses',
            'pathPrefix',
            'path_prefix',
            'updatedAfter',
            'updatedBefore',
            'createdAfter',
            'createdBefore',
            'timestampAfter',
            'timestampBefore',
            'tags',
            'kuId',
            'kuIds',
            'ku_id',
            'ku_ids',
            'sourceKuId',
            'sourceKuIds',
            'source_ku_id',
            'source_ku_ids',
            'targetKuId',
            'targetKuIds',
            'target_ku_id',
            'target_ku_ids',
            'includeDiscarded',
            'include_discarded',
            'includeObsolete',
            'include_obsolete',
            'audit',
            'recovery',
        ]) {
            if (options[key] !== undefined) {
                filters[key] = options[key];
            }
        }

        const statusFilter = toSet(filters.status ?? filters.statuses);
        const excluded = new Set(toArray(
            filters.excludeStatus
                ?? filters.excludedStatus
                ?? filters.excludedStatuses
                ?? filters.excluded_status
                ?? filters.excluded_statuses
                ?? filters.exclude_status
                ?? filters.exclude_statuses,
        ));
        const includeDiscarded = Boolean(
            options.includeDiscarded
                || options.audit
                || options.recovery
                || filters.includeDiscarded
                || filters.include_discarded
                || filters.audit
                || filters.recovery,
        );
        const includeObsolete = Boolean(
            options.includeObsolete
                || options.audit
                || options.recovery
                || filters.includeObsolete
                || filters.include_obsolete
                || filters.audit
                || filters.recovery,
        );
        if (!statusFilter.size) {
            for (const status of DEFAULT_EXCLUDED_STATUSES) {
                if (status === 'discarded' && includeDiscarded) {
                    continue;
                }
                if (status === 'obsolete' && includeObsolete) {
                    continue;
                }
                excluded.add(status);
            }
        }

        return {
            matches(record) {
                if (statusFilter.size && !statusFilter.has(record.status)) {
                    return false;
                }
                if (excluded.has(record.status) || excluded.has(record.ku_status)) {
                    return false;
                }
                if (!matchSet(record.record_type, filters.recordType ?? filters.recordTypes ?? filters.record_type ?? filters.record_types)) {
                    return false;
                }
                if (!matchSet(record.ku_type, filters.kuType ?? filters.kuTypes ?? filters.ku_type ?? filters.ku_types)) {
                    return false;
                }
                if (!matchSet(record.document_type, filters.documentType ?? filters.documentTypes ?? filters.document_type ?? filters.document_types)) {
                    return false;
                }
                if (!matchSet(record.result_type, filters.resultType ?? filters.resultTypes ?? filters.result_type ?? filters.result_types)) {
                    return false;
                }
                if (!matchSet(record.file_type, filters.fileType ?? filters.fileTypes ?? filters.file_type ?? filters.file_types)) {
                    return false;
                }
                if (!matchSet(record.relation, filters.linkRelation ?? filters.linkRelations ?? filters.link_relation ?? filters.link_relations)) {
                    return false;
                }
                if (!matchSet(record.ku_id, filters.kuId ?? filters.kuIds ?? filters.ku_id ?? filters.ku_ids)) {
                    return false;
                }
                if (!matchSet(record.source_ku_id, filters.sourceKuId ?? filters.sourceKuIds ?? filters.source_ku_id ?? filters.source_ku_ids)) {
                    return false;
                }
                if (!matchSet(record.target_ku_id, filters.targetKuId ?? filters.targetKuIds ?? filters.target_ku_id ?? filters.target_ku_ids)) {
                    return false;
                }
                const pathPrefix = filters.pathPrefix ?? filters.path_prefix;
                if (pathPrefix && !String(record.path ?? '').startsWith(String(pathPrefix))) {
                    return false;
                }
                const updatedAfter = filters.updatedAfter ?? filters.updated_after;
                const updatedBefore = filters.updatedBefore ?? filters.updated_before;
                const timestampAfter = filters.timestampAfter ?? filters.timestamp_after;
                const timestampBefore = filters.timestampBefore ?? filters.timestamp_before;
                const createdAfter = filters.createdAfter ?? filters.created_after;
                const createdBefore = filters.createdBefore ?? filters.created_before;
                if (updatedAfter && Date.parse(record.updated_at ?? '') < Date.parse(updatedAfter)) {
                    return false;
                }
                if (updatedBefore && Date.parse(record.updated_at ?? '') > Date.parse(updatedBefore)) {
                    return false;
                }
                const timestamp = Date.parse(record.updated_at ?? record.created_at ?? '') || 0;
                if (timestampAfter && timestamp < Date.parse(timestampAfter)) {
                    return false;
                }
                if (timestampBefore && timestamp > Date.parse(timestampBefore)) {
                    return false;
                }
                if (createdAfter && Date.parse(record.created_at ?? '') < Date.parse(createdAfter)) {
                    return false;
                }
                if (createdBefore && Date.parse(record.created_at ?? '') > Date.parse(createdBefore)) {
                    return false;
                }
                const tags = toArray(filters.tags).map(normalizePhrase);
                if (tags.length) {
                    const recordTags = new Set((record.tags ?? []).map(normalizePhrase));
                    for (const tag of tags) {
                        if (!recordTags.has(tag)) {
                            return false;
                        }
                    }
                }
                return true;
            },
        };
    }
}

function prepareRecord(record, ordinal, tokenizer) {
    const fieldTokens = {};
    const fieldLengths = {};
    const tokenSet = new Set();
    for (const field of SEARCH_FIELDS) {
        const tokens = tokenizer.tokenizeField(record[field], field);
        fieldTokens[field] = tokens;
        fieldLengths[field] = tokens.length;
        for (const token of tokens) {
            tokenSet.add(token);
        }
    }
    const exact = {
        title: normalizePhrase(record.title),
        summary: normalizePhrase(record.summary),
        path: normalizePhrase(record.path),
        type: normalizePhrase(record.type ?? record.ku_type ?? record.document_type ?? record.result_type ?? record.record_type),
        keywords: (record.keywords ?? []).map(normalizePhrase),
        tags: (record.tags ?? []).map(normalizePhrase),
        reusable: normalizePhrase(record.reusable_findings),
        allText: normalizePhrase(SEARCH_FIELDS.map(field => record[field]).join(' ')),
        acronyms: tokenizer.extractAcronyms(SEARCH_FIELDS.map(field => record[field]).join(' ')),
    };
    return {
        ...record,
        __ordinal: ordinal,
        __fieldTokens: fieldTokens,
        __fieldLengths: fieldLengths,
        __tokenSet: tokenSet,
        __exact: exact,
        __updatedMs: Date.parse(record.updated_at ?? record.created_at ?? '') || 0,
    };
}

function buildPostings(records) {
    const postings = new Map();
    for (const record of records) {
        for (const term of record.__tokenSet) {
            if (!postings.has(term)) {
                postings.set(term, []);
            }
            postings.get(term).push(record.__ordinal);
        }
    }
    for (const ordinals of postings.values()) {
        ordinals.sort((a, b) => a - b);
    }
    return postings;
}

function publicRecord(record) {
    const copy = {};
    for (const [key, value] of Object.entries(record)) {
        if (!key.startsWith('__')) {
            copy[key] = value;
        }
    }
    return copy;
}

function countTerm(tokens, term) {
    let count = 0;
    for (const token of tokens) {
        if (token === term) {
            count += 1;
        }
    }
    return count;
}

function hasExplicitPhrase(queryModel) {
    return Boolean(queryModel.phrases.length || queryModel.keywordPhrases.length);
}

function statusModifierFor(record) {
    return STATUS_MODIFIERS[record.status] ?? 0;
}

function statusStrength(status) {
    return STATUS_MODIFIERS[status] ?? 0;
}

function recencyModifierFor(record, nowMs) {
    const updated = record.__updatedMs;
    if (!updated) {
        return 0;
    }
    const ageDays = Math.max(0, (nowMs - updated) / 86400000);
    for (const bucket of RECENCY_MODIFIERS) {
        if (ageDays <= bucket.days) {
            return bucket.value;
        }
    }
    return 0;
}

function compareResults(a, b) {
    return (b.__sort.final - a.__sort.final)
        || (b.__sort.exactHitCount - a.__sort.exactHitCount)
        || (b.__sort.statusStrength - a.__sort.statusStrength)
        || (b.__sort.updatedMs - a.__sort.updatedMs)
        || (b.__sort.typePreference - a.__sort.typePreference)
        || String(a.search_id).localeCompare(String(b.search_id));
}

function applyDiversity(results, maxResultsPerKU) {
    if (!maxResultsPerKU || maxResultsPerKU <= 0) {
        return results;
    }
    const counts = new Map();
    const selected = [];
    for (const result of results) {
        const count = counts.get(result.ku_id) ?? 0;
        if (count >= maxResultsPerKU) {
            continue;
        }
        counts.set(result.ku_id, count + 1);
        selected.push(result);
    }
    return selected;
}

function toArray(value) {
    if (value === undefined || value === null) {
        return [];
    }
    return Array.isArray(value) ? value.map(String) : [String(value)];
}

function toSet(value) {
    return new Set(toArray(value).map(item => item.toLowerCase()));
}

function matchSet(recordValue, expected) {
    const values = toArray(expected);
    if (!values.length) {
        return true;
    }
    return values.map(value => value.toLowerCase()).includes(String(recordValue ?? '').toLowerCase());
}
