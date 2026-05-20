import { CONTEXT_PACK_DEFAULTS } from './constants.mjs';
import { normalizePhrase } from './tokenizer.mjs';
import { generateId, isoNow } from './schemas.mjs';

export class ContextPackBuilder {
    constructor(options = {}) {
        this.search = options.search;
        this.loadDetails = options.loadDetails;
        this.clock = options.clock ?? (() => new Date());
        this.defaultBudgetChars = options.contextBudgetChars ?? CONTEXT_PACK_DEFAULTS.budgetChars;
    }

    async build(query, options = {}) {
        const budgetChars = options.budgetChars ?? this.defaultBudgetChars;
        const lambda = options.lambda ?? CONTEXT_PACK_DEFAULTS.lambda;
        const candidateLimit = options.candidateLimit ?? CONTEXT_PACK_DEFAULTS.candidateLimit;
        const maxResultsPerKU = options.maxResultsPerKU ?? CONTEXT_PACK_DEFAULTS.maxResultsPerKU;
        const quotas = {
            ...CONTEXT_PACK_DEFAULTS.quotas,
            ...(options.quotas ?? {}),
        };
        const searchResult = await this.search(query, {
            ...options,
            explain: true,
            limit: candidateLimit,
            maxResultsPerKU: 0,
        });
        return this.buildFromCandidates(query, searchResult.results, {
            ...options,
            budgetChars,
            lambda,
            candidateLimit,
            maxResultsPerKU,
            quotas,
        });
    }

    async buildFromCandidates(query, candidateRecords = [], options = {}) {
        const budgetChars = options.budgetChars ?? this.defaultBudgetChars;
        const lambda = options.lambda ?? CONTEXT_PACK_DEFAULTS.lambda;
        const maxResultsPerKU = options.maxResultsPerKU ?? CONTEXT_PACK_DEFAULTS.maxResultsPerKU;
        const quotas = {
            ...CONTEXT_PACK_DEFAULTS.quotas,
            ...(options.quotas ?? {}),
        };
        const candidates = [...candidateRecords];
        const selected = [];
        const omitted = [];
        const perKu = new Map();
        const perType = new Map();
        const contextPackId = generateId('ctx', this.clock);
        const generatedAt = isoNow(this.clock);

        while (candidates.length) {
            let bestIndex = -1;
            let bestUtility = -Infinity;
            for (let index = 0; index < candidates.length; index += 1) {
                const candidate = candidates[index];
                if ((perKu.get(candidate.ku_id) ?? 0) >= maxResultsPerKU) {
                    continue;
                }
                if ((perType.get(candidate.record_type) ?? 0) >= (quotas[candidate.record_type] ?? Infinity)) {
                    continue;
                }
                const relevance = candidate.score + (candidate.record_type === 'ku' ? 0.20 : 0);
                const redundancy = maxRedundancy(candidate, selected);
                const utility = lambda * relevance - (1 - lambda) * redundancy;
                if (
                    utility > bestUtility
                    || (utility === bestUtility && compareCandidate(candidate, candidates[bestIndex]) < 0)
                ) {
                    bestUtility = utility;
                    bestIndex = index;
                }
            }
            if (bestIndex === -1) {
                omitted.push(...candidates.splice(0));
                break;
            }

            const [candidate] = candidates.splice(bestIndex, 1);
            const rendered = await this.renderItem(candidate, options, selected);
            const nextResults = [...selected.map(item => item.__rendered), rendered];
            const projectedUsed = measurePack({
                contextPackId,
                query,
                budgetChars,
                generatedAt,
                results: nextResults,
                omittedCount: omitted.length + candidates.length,
            });
            if (projectedUsed > budgetChars) {
                omitted.push(candidate);
                continue;
            }
            selected.push({
                source: candidate,
                __rendered: rendered,
            });
            perKu.set(candidate.ku_id, (perKu.get(candidate.ku_id) ?? 0) + 1);
            perType.set(candidate.record_type, (perType.get(candidate.record_type) ?? 0) + 1);
        }

        omitted.push(...candidates);
        const results = selected.map(item => item.__rendered);
        return finalizePack({
            context_pack_id: contextPackId,
            query,
            algorithm: 'bm25f_with_bounded_exact_boosts_mmr',
            budget_chars: budgetChars,
            used_chars: 0,
            generated_at: generatedAt,
            results,
            omitted: {
                count: omitted.length,
                reason: 'lower score, redundancy or budget limit',
            },
        });
    }

    async renderItem(result, options, selected) {
        const item = {
            search_id: result.search_id,
            ku_id: result.ku_id,
            record_type: result.record_type,
            title: result.title ?? '',
            summary: result.summary ?? '',
            status: result.status,
            tags: result.tags ?? [],
            keywords: result.keywords ?? [],
            path: result.path ?? '',
            score: result.score,
            matched_on: result.matched_on ?? [],
            loaded_level: 'L1',
        };
        if (result.scope) {
            item.scope = result.scope;
        }

        if (options.includeState && result.record_type === 'ku') {
            const details = await this.loadDetails(result, { includeState: true });
            item.state = details.state ?? '';
            item.loaded_level = 'L2';
        }
        if (options.includeHistory && result.record_type === 'ku') {
            const details = await this.loadDetails(result, { includeHistory: true });
            item.history = details.history ?? '';
            item.loaded_level = options.includeState ? 'L4' : 'L4';
        }
        if (options.explain) {
            item.why_included = whyIncluded(result, selected, item.loaded_level);
        }
        return item;
    }
}

function whyIncluded(result, selected, loadedLevel) {
    const terms = (result.matched_on ?? [])
        .filter(item => item.startsWith('term:'))
        .map(item => item.slice('term:'.length));
    const exactHits = (result.matched_on ?? []).filter(item => !item.startsWith('term:'));
    return {
        lexical_terms: terms,
        exact_hits: exactHits,
        status: result.status,
        novelty: selected.some(item => item.source.ku_id === result.ku_id) ? 'same_ku_additional_evidence' : 'new_ku',
        loaded_level: loadedLevel,
    };
}

function measurePack({ contextPackId, query, budgetChars, generatedAt, results, omittedCount }) {
    return finalizePack({
        context_pack_id: contextPackId,
        query,
        algorithm: 'bm25f_with_bounded_exact_boosts_mmr',
        budget_chars: budgetChars,
        used_chars: 0,
        generated_at: generatedAt,
        results,
        omitted: {
            count: omittedCount,
            reason: 'lower score, redundancy or budget limit',
        },
    }).used_chars;
}

function finalizePack(pack) {
    let usedChars = 0;
    let nextPack = pack;
    do {
        usedChars = nextPack.used_chars;
        nextPack = {
            ...nextPack,
            used_chars: JSON.stringify({
                ...nextPack,
                used_chars: usedChars,
            }).length,
        };
    } while (nextPack.used_chars !== usedChars);
    return nextPack;
}

function maxRedundancy(candidate, selected) {
    let max = 0;
    for (const item of selected) {
        max = Math.max(max, redundancy(candidate, item.source));
    }
    return max;
}

function redundancy(a, b) {
    let score = 0;
    if (a.ku_id === b.ku_id) {
        score += 0.35;
    }
    if (normalizePhrase(a.title) && normalizePhrase(a.title) === normalizePhrase(b.title)) {
        score += 0.25;
    }
    score += 0.15 * overlapRatio(a.tags ?? [], b.tags ?? []);
    score += 0.15 * overlapRatio(a.keywords ?? [], b.keywords ?? []);
    score += 0.20 * tokenJaccard(a, b);
    if (pathAncestry(a.path, b.path)) {
        score += 0.15;
    }
    if (a.record_type === b.record_type) {
        score += 0.10;
    }
    return Math.min(1, score);
}

function tokenJaccard(a, b) {
    const aTokens = new Set(normalizePhrase(`${a.title} ${a.summary}`).split(/\s+/).filter(Boolean));
    const bTokens = new Set(normalizePhrase(`${b.title} ${b.summary}`).split(/\s+/).filter(Boolean));
    if (!aTokens.size || !bTokens.size) {
        return 0;
    }
    let intersection = 0;
    for (const token of aTokens) {
        if (bTokens.has(token)) {
            intersection += 1;
        }
    }
    return intersection / new Set([...aTokens, ...bTokens]).size;
}

function overlapRatio(a, b) {
    const left = new Set(a.map(normalizePhrase));
    const right = new Set(b.map(normalizePhrase));
    if (!left.size || !right.size) {
        return 0;
    }
    let intersection = 0;
    for (const value of left) {
        if (right.has(value)) {
            intersection += 1;
        }
    }
    return intersection / Math.max(left.size, right.size);
}

function pathAncestry(aPath, bPath) {
    const a = String(aPath ?? '');
    const b = String(bPath ?? '');
    return Boolean(a && b && (a.startsWith(`${b}/`) || b.startsWith(`${a}/`)));
}

function compareCandidate(a, b) {
    if (!b) {
        return -1;
    }
    return (b.score - a.score) || String(a.search_id).localeCompare(String(b.search_id));
}
