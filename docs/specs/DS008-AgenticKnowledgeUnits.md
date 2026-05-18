---
id: DS008
title: Agentic Knowledge Units
status: draft
owner: AchillesAgentLib
summary: Deterministic local-first Knowledge Unit storage, indexing, search, and ContextPack construction for agent memory.
---

# DS008 - Agentic Knowledge Units

## Introduction

Agentic Knowledge Units, abbreviated as AKU, define a deterministic local memory library for AchillesAgentLib. The library stores work products as local Knowledge Units, maintains aggregated root-level indexes, ranks short structured records with BM25F-style lexical search, and builds compact ContextPack objects for agents that need reusable context.

AKU is not an LLM feature, a semantic retrieval system, a vector database, or a replacement for the existing skill subsystems. It is a local filesystem-backed utility library that future agents, skills, and host applications may call when they need durable project memory. External agents decide what deserves to be stored, validated, updated, forked, discarded, or deleted. AKU provides the deterministic infrastructure for persisting, indexing, searching, repairing, and packaging that material.

This specification is the design contract for the first AchillesAgentLib implementation. Code changes that implement AKU must update this specification and the companion architecture document when behavior, module layout, public APIs, storage format, ranking semantics, or recovery behavior changes.

## Core Content

### Role In AchillesAgentLib

AKU must live inside AchillesAgentLib as a shared utility library, not as a skill subsystem. The intended module boundary is:

```txt
AgenticKnowledgeUnits/
  AgenticKnowledgeUnits.mjs
  index.mjs
  AgenticKnowledgeUnits.d.ts
  internal/
    constants.mjs
    errors.mjs
    schemas.mjs
    paths.mjs
    storage.mjs
    locking.mjs
    atomic-write.mjs
    indexing.mjs
    tokenizer.mjs
    ranking.mjs
    context-pack.mjs
    doctor.mjs
```

The root `index.mjs` should re-export the public AKU API, and `package.json` should expose an `./AgenticKnowledgeUnits` subpath. The implementation should not be wired into `MainAgent` by default. Host projects and skills may instantiate AKU explicitly when they want local memory.

The top-level public facade must be `AgenticKnowledgeUnits`. It should expose the user-facing API while delegating internally to small collaborators. The public import surface stays compact, but implementation classes and helpers may live in separate internal modules when that improves readability, SOLID boundaries, and focused tests.

AKU must not call `LLMAgent`, `callLLM`, search providers, or any external service internally. If a future skill uses an LLM to summarize a session and then stores that summary in AKU, the LLM work belongs to the caller. AKU only receives already-decided structured inputs.

### V1 Non-Goals

The first implementation must not include embeddings, semantic RAG, vector databases, network services, hidden LLM calls, native SQLite as the default backend, or a dependency on FlexSearch, Fuse, Lunr, MiniSearch, or another ranking library for core relevance.

AKU may include future adapter points for persisted postings or SQLite FTS5, but the v1 default must be plain local files, JSONL indexes, in-memory postings built at load time, and a custom deterministic BM25F pipeline.

V1 implementation work must explicitly reject the following shortcuts unless this DS is updated first: per-field BM25 score summation in place of classic BM25F, lock files created with `wx` in place of directory locks, skipping file sync for committed writes, omitting checksums, omitting pending transaction markers, omitting `doctor()`, replacing MMR ContextPack selection with simple top-k, and relying on repeated linear scans for warm search.

### Source Of Truth And Cache Boundaries

The durable source of truth must be the `.aku/kus/` tree and the KU-owned files under it. Root aggregated indexes are authoritative search caches, not the only durable state. If index files are missing, inconsistent, corrupt, or disagree with `index-meta.json`, AKU must prefer rebuilding from KU folders over trusting partial search state.

The root `.aku` folder should contain:

```txt
.aku/
  aku.json
  search-index.jsonl
  search-stats.json
  index-meta.json
  ku-index.jsonl
  documents-index.jsonl
  files-index.jsonl
  results-index.jsonl
  events-index.jsonl
  pending/
  kus/
    ku_<timestamp>_<suffix>/
      manifest.json
      state.md
      history.md
      documents/
      results/
      support/
      sessions/
      code/
      data/
```

`search-index.jsonl` is the denormalized fast-search file. `search-stats.json` stores BM25F statistics. `index-meta.json` stores schema versions, record counts, content hashes, source versions, build options, and rebuild timestamp. The type-specific JSONL files support browsing, filtered listing, inspection, and repair. They should not be required for normal search once `search-index.jsonl` and `search-stats.json` have loaded successfully.

The v1 `index-meta.json` schema must include:

```json
{
  "schema": 1,
  "generation_id": "idx_20260518_120000_ab12cd34",
  "aku_schema": 1,
  "record_counts": {
    "search": 0,
    "ku": 0,
    "document": 0,
    "file": 0,
    "result": 0,
    "event": 0
  },
  "files": {
    "search-index.jsonl": { "sha256": "hex", "bytes": 0, "records": 0 },
    "search-stats.json": { "sha256": "hex", "bytes": 0 }
  },
  "source": {
    "ku_root_version": 0,
    "built_from": ".aku/kus",
    "build_options_hash": "hex"
  },
  "generated_at": "2026-05-18T00:00:00.000Z"
}
```

`generation_id` must change on every coherent aggregate rebuild. `index-meta.json` must be written last and must be treated as the commit marker for the aggregate generation.

### Public API Contract

The public API should remain class-based for ergonomic use inside AchillesAgentLib and host applications:

```js
import { AgenticKnowledgeUnits } from 'ploinky-agent-lib/AgenticKnowledgeUnits';

const aku = new AgenticKnowledgeUnits({
    rootDir,
    actor,
    contextBudgetChars,
    lockTimeoutMs,
});
```

The v1 facade should expose these async filesystem APIs:

```txt
initAKU(metadata)
loadAKU()
exists()

initKU(metadata)
loadKU(kuId)
updateKUState(kuId, update)
setKUStatus(kuId, status, reason)

recordEvent(kuId, event)
recordDocument(kuId, document)
registerFile(kuId, file)
recordResult(kuId, result)
recordRun(kuId, run)
recordValidation(kuId, validation)

ingestSession(kuId, packet)
discardSession(kuId, sessionId, reason)

forkKU(kuId, options)
discardKU(kuId, reason)
deleteKU(kuId, options)

updateIndexes()
rebuildIndexes()
doctor(options)

search(query, options)
buildContextPack(query, options)

listKUs(filter)
listDocuments(filter)
listFiles(filter)
listResults(filter)
```

`search()` and `buildContextPack()` may execute synchronously internally after `loadAKU()` has built the memory index, but their public shape should be async for API consistency and to allow optional detail loading.

All mutating methods must acquire the relevant lock, update the source files, update aggregated indexes or schedule a batch rebuild, and refresh in-memory state consistently. Methods that only rank already-loaded data must not touch KU folders unless explicit options request details.

### Internal Design And Patterns

The implementation should use design patterns only where they reduce coupling or make recovery behavior clearer.

`AgenticKnowledgeUnits` is a Facade. It exposes the public API, coordinates collaborators, enforces lifecycle state, and keeps callers insulated from file layout and index details.

`AKUFileStore` is a Repository. It resolves safe paths, reads and writes AKU-owned files, parses JSON and JSONL, and provides source-of-truth record access. It must not score queries.

`AKULockManager` is a coordination service. It implements directory-based locks, stale-lock detection, lock metadata, refresh, timeout, and cleanup. It must not write business records.

`AtomicFileWriter` is a Unit-of-Work helper for filesystem replacement. It writes temp files in the same directory, syncs files, renames with retry, best-effort syncs parent directories where possible, and coordinates pending transaction markers.

`AKUIndexBuilder` is a Builder. It converts manifests, document records, result records, file records, and event summaries into denormalized search records and associated statistics.

`AKUTokenizer` is a Strategy. It owns Unicode normalization aliases, technical token splitting, stopword treatment, phrase extraction, acronym preservation, and diacritic folding. It must preserve original values for display.

`AKUSearchIndex` is an in-memory read model. It stores records, field token statistics, postings, and precomputed per-record field lengths. It should be replaceable after rebuilds rather than mutated in many unrelated places.

`BM25FScorer` is a Strategy. It computes the lexical score from query terms, field weights, field normalization, global document frequency, and candidate records.

`ExactMatchScorer` is a bounded side-channel scoring strategy. It computes exact keyword, tag, title, type, path, phrase, and acronym bonuses without overwhelming lexical evidence.

`FilterCompiler` uses the Specification pattern. It compiles query filters into composable predicates over search records and must run before scoring wherever possible.

`ContextPackBuilder` is a Builder with an MMR-style selection strategy. It consumes ranked results and produces a budgeted explainable ContextPack.

`AKUDoctor` is a recovery service. It validates schema, checksums, counts, JSONL parseability, source-index consistency, and pending transaction markers. It may rebuild indexes from KU folders.

This collaborator split is required regardless of file layout. Each collaborator must have one reason to change. Shared normalization, validation, ID generation, clock injection, checksum generation, and path safety helpers must be centralized so the implementation does not duplicate critical logic. Internal modules must remain private implementation details unless a future DS change explicitly promotes one of them to public API.

### Data Model

Every KU must have a `manifest.json` with stable identity, type, status, timestamps, version, tags, keywords, summary, reusable findings, lineage, and provenance. Required v1 fields are:

```txt
ku_id
ku_name
ku_type
status
created_at
updated_at
version
tags
keywords
summary
reusable_findings
lineage
```

Optional but recommended fields are:

```txt
parent_ku_id
last_event_id
last_session_id
last_document_id
outcome_status
created_by
updated_by
actor
source_operation
```

`status` describes whether the KU or record is active in the memory system. `outcome_status` describes the result of the work represented by the KU. They should remain separate because a failed experiment can be an active and valuable `failure_note`, while an obsolete accepted decision may be excluded from normal search.

`record_type` must remain separate from `ku_type`, `document_type`, and `result_type`. `record_type` controls which aggregate index and rendering contract applies. The more specific type fields describe the domain meaning of the record.

`reusable_findings` may remain an array of strings in v1, but the schema must allow migration to structured findings with IDs, provenance, confidence, validation status, and supporting result links. Search indexing should treat current strings and future structured finding text through one helper so the migration does not fork ranking behavior.

File records should include path, role, status, summary, tags, keywords, hash, size, MIME type when available, and last modified time when available. Hashes should use SHA-256. The display path stored in indexes should be relative to the AKU root, while the implementation resolves absolute paths internally under a trusted root.

Deletion policy must be explicit. `discardKU()` must tombstone by setting status to `discarded`, recording a discard event, and excluding the KU from normal search. `deleteKU(kuId, { confirm: true })` may physically remove the KU folder and all aggregate index records. Physical deletion must require explicit confirmation. Normal search must never include discarded records unless the caller uses an explicit recovery or audit option.

### Search Indexing

`loadAKU()` should parse `search-index.jsonl` and `search-stats.json` once, validate them against `index-meta.json`, retain records in memory, and build an ephemeral postings map. Normal search must not open individual KU folders.

The v1 postings model should be simple:

```txt
Map<term, number[]>      // sorted record ordinals
Map<recordOrdinal, stats>
Array<searchRecord>
```

The implementation may upgrade postings arrays to `Uint32Array` after construction when profiling shows value. The source code should isolate postings construction so this representation can change without changing scoring.

Document frequency should be global per record for v1. Per-field document frequency is a possible future enhancement, but it should not complicate the first implementation.

Index rebuilds should be full rewrites after mutation batches. Incremental append logs, tombstone compaction, persistent postings, and SQLite backends are future optimizations. V1 must prioritize repairability, deterministic behavior, and readability over micro-updates.

### Tokenization And Normalization

Tokenization must be conservative and technical-identifier-aware. AKU should preserve the original string for display, store lowercased and normalized aliases for matching, and avoid destructive replacement of source values.

The tokenizer should:

- preserve complete original tokens where useful;
- case-fold aliases to lowercase for matching;
- produce Unicode normalization aliases, preferably NFC for canonical preservation and NFKC for compatibility matching;
- produce diacritic-folded aliases rather than replacing the original token;
- split hyphen, underscore, dot, slash, and camelCase or PascalCase boundaries while keeping useful full-token forms;
- preserve acronym surfaces for exact matching;
- remove stopwords from BM25 scoring but preserve them inside explicit phrase matching;
- keep stemming disabled by default.

Path tokenization must be separate from path safety. Search aliases may split paths for retrieval, but security checks must operate on real filesystem paths with root containment checks.

### BM25F Ranking

AKU must implement classic BM25F-style scoring rather than summing independent BM25 scores per field. For each query term, the scorer should combine normalized field evidence before applying saturation, then combine terms.

Default field weights should be moderate:

```txt
keywords: 6
tags: 5
title: 4
reusable_findings: 3
summary: 2
type: 1
path: 1
```

The default BM25F `k1` must be `1.2`. Field length normalization should be field-specific. Tags, keywords, and type should have low or zero normalization because they are intentionally short curated fields. Summary and reusable findings should use normal length correction. Title and path should use mild correction. V1 should expose these as constants and make them test-visible:

```txt
keywords b: 0.0
tags b: 0.0
type b: 0.0
title b: 0.35
path b: 0.35
summary b: 0.75
reusable_findings b: 0.75
```

Query source weights should distinguish free text from explicit intent:

```txt
free text: 1.0
explicit keyword: 1.7
explicit tag: 2.0
quoted phrase: 2.3
```

The scorer should normalize lexical scores before adding side-channel metadata:

```txt
lexical = bm25f / (1 + bm25f)
final = lexical + exact_bonus + status_modifier + recency_modifier
```

The exact formula may be tuned during implementation, but exact, status, and recency signals must remain bounded. Large uncapped additive boosts are not permitted because they make short-corpus ranking unstable.

### Exact Match And Phrase Policy

Exact boosts must be deterministic, bounded, and explainable. V1 should support exact keyword phrase, exact tag, title phrase, type, path substring, reusable finding phrase, quoted phrase, and acronym matches.

Exact boosts should accumulate into a capped `exact_bonus` value. A record with several exact hits may reach the cap, but it must not keep accumulating unbounded points. Exact matches must be reported through `matched_on` and, when requested, `score_components`.

The initial normalized exact-match constants should be:

```txt
exact_bonus_cap: 0.35
exact keyword phrase: 0.18
exact tag: 0.16
quoted phrase: 0.14
title phrase: 0.12
reusable finding phrase: 0.10
type: 0.08
path substring: 0.06
acronym: 0.05
```

Quoted phrases and explicit keyword phrases must not be checked only after a narrow top-k lexical pass. The implementation should intersect postings for phrase terms and verify phrase order over the candidate record text, or otherwise scan the in-memory records after filters when a phrase is explicit. This prevents common component terms from hiding a decisive exact phrase.

### Filters, Status, And Diversity

Explicit filters must be applied before scoring. Supported filters should include record type, KU type, document type, status, excluded status, path prefix, timestamp, tags, and KU ID.

Normal search should exclude `discarded` and `obsolete` records by default. `discarded` must require an explicit opt-in search mode. `invalidated` and `failure_note` records should remain findable when the caller searches for failures, warnings, or historical evidence.

Status and recency must be weak bounded modifiers. An old validated finding can outrank a recent provisional note when lexical and exact evidence justify it.

The initial normalized status and recency constants should be:

```txt
status validated: +0.10
status accepted: +0.08
status active: +0.04
status provisional: -0.03
status archived: -0.05
status invalidated: -0.08
status obsolete: excluded by default, -0.12 when explicitly included
status discarded: excluded unless explicit audit/recovery mode

updated within 7 days: +0.04
updated within 30 days: +0.025
updated within 180 days: +0.01
older: +0.0
```

Search result diversity should be deterministic. `maxResultsPerKU` should default to 3 for `search()` and 2 for `buildContextPack()`. Ties should break by final score, exact-hit count, status strength, updated timestamp, record type preference, and stable `search_id`.

### ContextPack Construction

`buildContextPack()` must reuse the same ranking pipeline as `search()` and then perform budgeted selection. It must not implement a separate relevance system.

The default v1 selector should use greedy MMR-style packing:

```txt
utility = lambda * relevance - (1 - lambda) * redundancy
```

The default `lambda` should be `0.75`. Redundancy must be computed deterministically from local lexical signals rather than embeddings. Acceptable redundancy inputs include same KU ID, same normalized title, overlapping tags and keywords, token Jaccard overlap, path ancestry, and record-type repetition.

The packer should respect:

- explicit `budgetChars`;
- `maxResultsPerKU`;
- type quotas for KUs, documents, results, files, and events;
- preference for KU summaries and reusable findings before long details;
- `includeState`, `includeHistory`, and detail-loading options;
- deterministic omission accounting.

`ContextPack` should optimize primarily for character count. It may expose an approximate token estimate, but token estimation must not become a required runtime dependency.

Each item should include `why_included` when explanation is requested:

```json
{
  "why_included": {
    "lexical_terms": ["bm25f", "context", "pack"],
    "exact_hits": ["tag:AKU", "keyword:\"Knowledge Unit\""],
    "status": "validated",
    "novelty": "new_ku",
    "loaded_level": "L1"
  }
}
```

The v1 ContextPack top-level schema must include:

```json
{
  "context_pack_id": "ctx_20260518_120000_ab12cd34",
  "query": {},
  "algorithm": "bm25f_with_bounded_exact_boosts_mmr",
  "budget_chars": 6000,
  "used_chars": 0,
  "generated_at": "2026-05-18T00:00:00.000Z",
  "results": [],
  "omitted": {
    "count": 0,
    "reason": "lower score, redundancy or budget limit"
  }
}
```

`used_chars` must be computed from the rendered pack payload, not from the original source records. `budget_chars` must be respected for the returned payload except for a documented hard minimum envelope overhead when the caller supplies an impossibly small budget.

### Filesystem Reliability

AKU writes must use directory-based locks, temp-file replacement, fsync where available, rename retries, and pending transaction markers.

The lock manager should use atomic `mkdir` for `.aku/lock` and `.aku/kus/<ku_id>/lock`. Lock metadata should include owner, PID, hostname, created timestamp, refreshed timestamp, and operation label. Stale locks should be detected through mtime and metadata age. Lock cleanup must tolerate already-removed directories.

The initial lock and retry constants should be:

```txt
lock acquisition timeout: 5000 ms
stale lock age: 30000 ms
lock refresh interval for long operations: 10000 ms
rename/unlink cleanup retries: 6
retry backoff: 25 ms, 50 ms, 100 ms, 200 ms, 400 ms, 500 ms
parent directory fsync failure: warning-only unless strictFsync is enabled
```

PID liveness may be used as an advisory stale-lock signal, but it must not be the only stale-lock criterion. The lock directory mtime and lock metadata age remain the cross-platform source of truth.

Atomic replacement must follow this sequence:

```txt
acquire lock
write pending/txn_<id>.json
write temp file in same target directory
sync temp file
rename temp -> target with bounded retry
best-effort sync parent directory
update index-meta.json last
remove pending marker
release lock
```

Multi-file operations are not atomically committed by rename alone. `index-meta.json` is the commit marker for a coherent aggregate-index generation. On startup, any pending transaction marker or metadata mismatch must cause `loadAKU()` to report recoverable inconsistency and either invoke `doctor({ autoRepair: true })` when configured or instruct the caller to run `doctor()` or `rebuildIndexes()`.

Windows-specific transient `EPERM`, `EACCES`, and `EBUSY` around rename, unlink, and cleanup must be retried with bounded exponential backoff.

### Security And Path Safety

AKU must reject absolute user-supplied paths for records that are meant to be AKU-relative. It must resolve every relative path against a trusted root, use canonical filesystem paths when the target exists, and verify that the result remains beneath the root. `path.isAbsolute()` alone is not a traversal defense.

Symlink policy must be explicit:

- files inside `.aku` should not be symlinks unless a future option enables them;
- user-registered external files may be indexed by metadata only when their resolved path stays under an allowed root;
- `lstat()` should be used when detecting symlinks before following them;
- `realpath()` should be used for containment checks where paths exist.

Index records must not include sensitive content by accident. V1 should support an exclusion policy for paths, field names, and record types before indexing. Deleted or discarded KUs should either be tombstoned or physically removed according to an explicit option. Normal search must exclude discarded material.

### Error Model

Errors should be typed with stable `code` values. The implementation should define AKU-specific error classes or a shared `AKUError` with code values such as:

```txt
AKU_NOT_FOUND
AKU_ALREADY_EXISTS
AKU_LOCK_TIMEOUT
AKU_STALE_LOCK
AKU_CORRUPT_INDEX
AKU_SCHEMA_ERROR
AKU_PATH_ESCAPE
AKU_INVALID_STATUS
AKU_TRANSACTION_PENDING
AKU_REBUILD_REQUIRED
```

Public methods should throw deterministic errors with actionable messages. Recovery-capable operations should include whether a rebuild or doctor operation is safe.

### Implementation Plan

Phase 1 should establish the module shell, public entry point, public facade, internal module layout, `.d.ts` declarations, package exports, constructor validation, error classes, path helpers, constants, and empty lifecycle methods with focused tests.

Phase 2 should implement storage layout, manifest schema validation, safe path resolution, ID generation, clock injection, status normalization, and atomic writes with locks.

Phase 3 should implement rebuilds from KU folders, aggregate JSONL output, `search-stats.json`, `index-meta.json`, checksums, and `doctor()`.

Phase 4 should implement tokenizer, in-memory postings, BM25F scoring, exact side-channel scoring, filters, status and recency modifiers, explanations, and search tests.

Phase 5 should implement ContextPack construction, MMR redundancy, character budgeting, L1/L2 detail loading, omission reporting, and explainability.

Phase 6 should add corruption and crash-recovery tests, Windows-path unit tests, benchmark fixtures, and public documentation updates.

### Testing And Evaluation

Tests must cover pure helpers separately from filesystem integration. The test suite should include:

- tokenizer cases for Unicode, diacritics, acronyms, camelCase, snake_case, hyphenated terms, paths, and phrases;
- BM25F cases proving field evidence is combined before saturation;
- exact boost cap cases proving boosts do not swamp lexical evidence unboundedly;
- filter and status behavior;
- JSONL rebuild and checksum behavior;
- transaction recovery with pending markers;
- stale lock detection;
- path traversal and symlink rejection;
- ContextPack budget and redundancy behavior;
- package export smoke tests.

The initial concrete test files should be:

```txt
tests/agenticKnowledgeUnits/storage.test.mjs
tests/agenticKnowledgeUnits/search.test.mjs
tests/agenticKnowledgeUnits/indexing.test.mjs
tests/agenticKnowledgeUnits/contextPack.test.mjs
tests/agenticKnowledgeUnits/agenticKnowledgeUnits.test.mjs
tests/agenticKnowledgeUnits/recovery.test.mjs
tests/agenticKnowledgeUnits/security.test.mjs
tests/agenticKnowledgeUnits/packageExports.test.mjs
```

`storage.test.mjs` must cover atomic writes, JSON/JSONL round trips, directory creation, and safe relative path resolution. `search.test.mjs` must cover tokenizer aliases, classic BM25F combination, bounded exact boosts, status and recency modifiers, phrase handling, tie breaks, and score explanations. `indexing.test.mjs` must cover full rebuilds, stats, checksums, metadata, and in-memory postings. `contextPack.test.mjs` must cover character budgets, MMR redundancy, quotas, loaded levels, `why_included`, and omission accounting. `agenticKnowledgeUnits.test.mjs` must cover the public lifecycle. `recovery.test.mjs` must cover pending markers, corrupt JSONL, missing indexes, stale locks, and checksum mismatch. `security.test.mjs` must cover traversal, symlink, absolute-path, and sensitive-field exclusion behavior. `packageExports.test.mjs` must prove the package root and `./AgenticKnowledgeUnits` export work.

Benchmarks should measure cold `loadAKU()`, warm `search()`, `buildContextPack()`, rebuild time, memory use, write latency, doctor time, and recovery from forced interruption. Retrieval quality should be evaluated with synthetic and real relevance judgments using nDCG@10, MRR, MAP, Precision@k, and Recall@k. V1 acceptance should prioritize correctness and repairability before high-scale optimization.

The initial performance targets for warm processes are engineering acceptance targets, not research claims:

```txt
1,000 search records: search() under 25 ms for typical filtered queries
10,000 search records: search() under 200 ms for typical filtered queries
buildContextPack() L1: under 100 ms after search candidates are available
rebuildIndexes(): dominated by filesystem throughput and not quadratic in record count
doctor(): able to rebuild after deleted search index, corrupt stats, pending transaction marker, or metadata hash mismatch
```

## Decisions & Questions

### Question #1: Why should AKU implement custom BM25F instead of delegating search to a library?

Response: AKU needs deterministic field-aware ranking, bounded exact-match policy, explainable score components, compact JSONL search caches, and repairability from KU folders. Existing local JavaScript libraries are useful references but do not provide the exact combination of classic BM25F semantics, AKU-specific exact channels, ContextPack explanations, and single public entry-point control required by this design.

### Question #2: Why are KU folders the durable source of truth rather than `search-index.jsonl`?

Response: Root-level indexes exist for speed. KU folders preserve full source material, manifests, state, history, documents, results, and support files. Treating indexes as rebuildable caches makes corruption recovery simpler and aligns with the local-first repairability goal.

### Question #3: Why use JSONL plus in-memory postings for v1?

Response: JSONL is inspectable, streamable, easy to rebuild, and adequate for thousands or tens of thousands of short records. In-memory postings avoid repeated linear scans during warm search without introducing a binary index format or SQLite dependency in the first release.

### Question #4: How does a compact `.mjs` module remain compatible with SOLID?

Response: The public API can remain a compact entry point while implementation collaborators live in separate internal modules. SOLID requires clear responsibilities, explicit dependencies, stable abstractions, and minimal reasons to change. V1 should keep the import surface compact while keeping responsibilities distinct, readable, and testable.

### Question #5: Why keep SQLite FTS5 out of the default v1 path?

Response: SQLite FTS5 is a strong future backend, especially for larger corpora and richer phrase queries. It is not the right default for v1 because the AKU scoring pipeline is custom, JSONL repairability is a hard constraint, and AchillesAgentLib currently has no mandatory SQLite dependency. SQLite should be additive rather than foundational.

### Question #6: Why use MMR for ContextPack selection?

Response: ContextPack construction is a relevance-plus-budget-plus-redundancy problem. Simple top-k can overrepresent one KU or one repeated conclusion. MMR is deterministic, simple to implement with lexical redundancy signals, and adequate before AKU has explicit query-aspect modeling.

### Question #7: Should `reusable_findings` be structured in v1?

Response: V1 may store reusable findings as strings to keep the schema simple, but the indexing helper must be designed so structured findings can be introduced later without changing search behavior. Future fields should include ID, confidence, validation status, provenance, and supporting result links.

### Question #8: What commits a coherent aggregate-index generation?

Response: `index-meta.json` is the commit marker. Data files may be replaced one by one, but the generation should not be considered coherent until metadata has been written last with matching hashes and counts. Pending transaction markers and checksum mismatches must trigger doctor or rebuild behavior.

### Question #9: Should search be synchronous or asynchronous?

Response: Public methods should be async for consistency and future extensibility. Internal warm ranking may be synchronous because records and postings are already in memory after `loadAKU()`.

### Question #10: Where should AKU integrate with `MainAgent`?

Response: AKU should not be implicit in `MainAgent` v1. Explicit construction by host projects or skills avoids hidden persistence, avoids changing existing agent behavior, and respects the current AchillesAgentLib separation between runtime orchestration and supporting utilities.

## Conclusion

AKU should be implemented as an additive AchillesAgentLib utility that exposes a deterministic facade over local Knowledge Unit storage, root-level JSONL indexes, classic BM25F lexical search, bounded exact matching, MMR ContextPack construction, and robust filesystem recovery. The first release should privilege source-of-truth clarity, repairability, score explainability, and testable internal boundaries over large-corpus optimizations. Future backends such as persisted postings or SQLite FTS5 should remain possible without changing the public API or weakening the local-first contract.
