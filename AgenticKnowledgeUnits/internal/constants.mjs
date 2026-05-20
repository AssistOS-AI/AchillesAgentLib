export const AKU_SCHEMA_VERSION = 1;
export const INDEX_SCHEMA_VERSION = 1;

export const AKU_DIRNAME = '.aku';
export const ROOT_LOCK_NAME = 'lock';
export const PENDING_DIRNAME = 'pending';
export const KUS_DIRNAME = 'kus';

export const ROOT_FILES = Object.freeze({
    aku: 'aku.json',
    searchIndex: 'search-index.jsonl',
    searchStats: 'search-stats.json',
    indexMeta: 'index-meta.json',
    kuIndex: 'ku-index.jsonl',
    documentsIndex: 'documents-index.jsonl',
    filesIndex: 'files-index.jsonl',
    linksIndex: 'links-index.jsonl',
    resultsIndex: 'results-index.jsonl',
    eventsIndex: 'events-index.jsonl',
});

export const ALL_INDEX_FILES = Object.freeze([
    ROOT_FILES.searchIndex,
    ROOT_FILES.searchStats,
    ROOT_FILES.kuIndex,
    ROOT_FILES.documentsIndex,
    ROOT_FILES.filesIndex,
    ROOT_FILES.linksIndex,
    ROOT_FILES.resultsIndex,
    ROOT_FILES.eventsIndex,
]);

export const JSONL_INDEX_FILES = Object.freeze([
    ROOT_FILES.searchIndex,
    ROOT_FILES.kuIndex,
    ROOT_FILES.documentsIndex,
    ROOT_FILES.filesIndex,
    ROOT_FILES.linksIndex,
    ROOT_FILES.resultsIndex,
    ROOT_FILES.eventsIndex,
]);

export const KU_FILES = Object.freeze({
    manifest: 'manifest.json',
    state: 'state.md',
    history: 'history.md',
    events: 'events.jsonl',
    documents: 'documents/documents.jsonl',
    files: 'support/files.jsonl',
    links: 'links/links.jsonl',
    results: 'results/results.jsonl',
    sessions: 'sessions/sessions.jsonl',
});

export const KU_DIRECTORIES = Object.freeze([
    'documents',
    'results',
    'support',
    'links',
    'sessions',
    'code',
    'data',
]);

export const RECORD_TYPES = Object.freeze({
    ku: 'ku',
    document: 'document',
    file: 'file',
    link: 'link',
    result: 'result',
    event: 'event',
});

export const RECORD_TYPE_PREFERENCE = Object.freeze({
    ku: 5,
    document: 4,
    result: 3,
    file: 2,
    link: 1.5,
    event: 1,
});

export const KU_LINK_RELATIONS = Object.freeze([
    'contains',
    'references',
    'depends_on',
    'derived_from',
    'forked_from',
    'supersedes',
    'contradicts',
    'validates',
    'uses_dataset',
    'produced_result',
]);

export const STATUSES = Object.freeze([
    'active',
    'validated',
    'accepted',
    'provisional',
    'archived',
    'invalidated',
    'obsolete',
    'discarded',
    'failure_note',
]);

export const DEFAULT_EXCLUDED_STATUSES = Object.freeze(['discarded', 'obsolete']);

export const STATUS_MODIFIERS = Object.freeze({
    validated: 0.10,
    accepted: 0.08,
    active: 0.04,
    failure_note: 0.02,
    provisional: -0.03,
    archived: -0.05,
    invalidated: -0.08,
    obsolete: -0.12,
    discarded: -0.20,
});

export const RECENCY_MODIFIERS = Object.freeze([
    { days: 7, value: 0.04 },
    { days: 30, value: 0.025 },
    { days: 180, value: 0.01 },
]);

export const LOCK_DEFAULTS = Object.freeze({
    timeoutMs: 5000,
    staleMs: 30000,
    refreshMs: 10000,
});

export const RETRY_DEFAULTS = Object.freeze({
    attempts: 6,
    backoffMs: [25, 50, 100, 200, 400, 500],
});

export const BM25F_DEFAULTS = Object.freeze({
    k1: 1.2,
    fieldWeights: Object.freeze({
        keywords: 6,
        tags: 5,
        title: 4,
        reusable_findings: 3,
        summary: 2,
        type: 1,
        path: 1,
    }),
    fieldB: Object.freeze({
        keywords: 0,
        tags: 0,
        type: 0,
        title: 0.35,
        path: 0.35,
        summary: 0.75,
        reusable_findings: 0.75,
    }),
});

export const SEARCH_FIELDS = Object.freeze([
    'keywords',
    'tags',
    'title',
    'reusable_findings',
    'summary',
    'type',
    'path',
]);

export const QUERY_WEIGHTS = Object.freeze({
    text: 1.0,
    keyword: 1.7,
    tag: 2.0,
    phrase: 2.3,
});

export const EXACT_BOOSTS = Object.freeze({
    cap: 0.35,
    keywordPhrase: 0.18,
    tag: 0.16,
    quotedPhrase: 0.14,
    titlePhrase: 0.12,
    reusableFindingPhrase: 0.10,
    type: 0.08,
    pathSubstring: 0.06,
    acronym: 0.05,
});

export const SEARCH_DEFAULTS = Object.freeze({
    limit: 10,
    maxResultsPerKU: 3,
});

export const CONTEXT_PACK_DEFAULTS = Object.freeze({
    budgetChars: 6000,
    lambda: 0.75,
    candidateLimit: 50,
    maxResultsPerKU: 2,
    quotas: Object.freeze({
        ku: 4,
        document: 5,
        result: 5,
        file: 4,
        link: 3,
        event: 2,
    }),
});

export const STOPWORDS = Object.freeze(new Set([
    'a',
    'an',
    'and',
    'are',
    'as',
    'at',
    'be',
    'by',
    'for',
    'from',
    'has',
    'have',
    'in',
    'is',
    'it',
    'its',
    'of',
    'on',
    'or',
    'that',
    'the',
    'this',
    'to',
    'was',
    'were',
    'with',
]));

export const SENSITIVE_FIELD_NAMES = Object.freeze(new Set([
    'api_key',
    'apikey',
    'authorization',
    'cookie',
    'credential',
    'credentials',
    'password',
    'private_key',
    'secret',
    'session_token',
    'token',
]));

export const SENSITIVE_PATH_PARTS = Object.freeze(new Set([
    '.env',
    '.npmrc',
    '.ssh',
    'id_rsa',
    'id_dsa',
    'secrets',
]));
