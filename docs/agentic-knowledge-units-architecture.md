# Agentic Knowledge Units Architecture Plan

This document is the visual implementation companion to [DS008 - Agentic Knowledge Units](specs/DS008-AgenticKnowledgeUnits.md). The DS file is the governing contract. This document explains the architecture, flow boundaries, and implementation sequence with Mermaid diagrams.

## Architectural Position

AKU is an additive AchillesAgentLib utility library. It is not part of `MainAgent` session execution, not a skill subsystem, and not an LLM feature. Skills and host applications call AKU explicitly when they want local project memory.

```mermaid
flowchart TB
    Host["Host project or Achilles skill"] --> Facade["AgenticKnowledgeUnits facade"]
    MainAgent["MainAgent"] -. no implicit coupling .- Facade
    LLMAgent["LLMAgent"] -. not called by AKU .- Facade

    Facade --> Store["AKUFileStore"]
    Facade --> Index["AKUSearchIndex"]
    Facade --> Packer["ContextPackBuilder"]
    Facade --> Doctor["AKUDoctor"]

    Store --> AkuFolder["root/.aku"]
    AkuFolder --> KUs["kus/* source folders"]
    AkuFolder --> Aggregates["root JSONL indexes"]

    Index --> Ranking["BM25FScorer + ExactMatchScorer"]
    Packer --> Ranking
```

The boundary is deliberate: AchillesAgentLib already contains the agent runtime, LLM layer, skill subsystems, and supporting utilities. AKU should provide local durable memory that those layers may use, without creating hidden persistence or hidden inference.

## Module Layout

The first implementation should use one compact public entry point, a public facade class, type declarations, and private internal modules for storage, ranking, indexing, context packing, and recovery.

```mermaid
flowchart LR
    RootIndex["index.mjs"] --> AKUIndex["AgenticKnowledgeUnits/index.mjs"]
    Package["package.json exports"] --> AKUIndex
    AKUIndex --> Runtime["AgenticKnowledgeUnits/AgenticKnowledgeUnits.mjs"]
    Runtime --> Internal["AgenticKnowledgeUnits/internal/*.mjs"]
    Types["AgenticKnowledgeUnits/AgenticKnowledgeUnits.d.ts"] -. describes .-> Runtime
    Tests["tests/agenticKnowledgeUnits/*.test.mjs"] --> Runtime
    Tests --> Internal
```

The entry point is the stable API. Internal files are allowed and preferred where they make responsibilities clearer, but callers must not import them directly.

The initial internal layout is:

```txt
AgenticKnowledgeUnits/
  index.mjs
  AgenticKnowledgeUnits.mjs
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

## Storage Layout

```mermaid
flowchart TB
    Root["Project root"] --> Aku[".aku/"]
    Aku --> Config["aku.json"]
    Aku --> Search["search-index.jsonl"]
    Aku --> Stats["search-stats.json"]
    Aku --> Meta["index-meta.json"]
    Aku --> Pending["pending/txn_*.json"]
    Aku --> TypeIndexes["ku/documents/files/results/events indexes"]
    Aku --> KUs["kus/"]

    KUs --> KU["ku_20260516_ab12cd34/"]
    KU --> Manifest["manifest.json"]
    KU --> State["state.md"]
    KU --> History["history.md"]
    KU --> Documents["documents/"]
    KU --> Results["results/"]
    KU --> Support["support/ sessions/ code/ data/"]

    Manifest -. source of truth .-> TypeIndexes
    TypeIndexes -. rebuild input .-> Search
    Search -. fast load .-> Memory["in-memory records + postings"]
    Stats -. scoring stats .-> Memory
```

The aggregate files are search caches. The KU folders remain the durable source of truth.

## Runtime Lifecycle

```mermaid
sequenceDiagram
    participant Caller
    participant AKU as AgenticKnowledgeUnits
    participant Store as AKUFileStore
    participant Doctor as AKUDoctor
    participant Index as AKUSearchIndex

    Caller->>AKU: loadAKU()
    AKU->>Store: read aku.json, index-meta.json
    AKU->>Doctor: validate pending markers, hashes, counts
    alt indexes coherent
        AKU->>Store: parse search-index.jsonl and search-stats.json
        AKU->>Index: build in-memory postings
        AKU-->>Caller: ready
    else repair required and autoRepair enabled
        AKU->>Doctor: rebuildIndexes()
        Doctor->>Store: scan KU folders
        Doctor->>Store: rewrite aggregate indexes
        AKU->>Index: reload rebuilt postings
        AKU-->>Caller: ready
    else repair required
        AKU-->>Caller: AKU_REBUILD_REQUIRED
    end
```

## Write Transaction Flow

```mermaid
sequenceDiagram
    participant Caller
    participant AKU as AgenticKnowledgeUnits
    participant Lock as AKULockManager
    participant Store as AKUFileStore
    participant Writer as AtomicFileWriter
    participant Builder as AKUIndexBuilder

    Caller->>AKU: recordDocument(kuId, document)
    AKU->>Lock: acquire root + KU locks
    Lock-->>AKU: lock leases
    AKU->>Writer: create pending txn marker
    AKU->>Store: update KU-owned document metadata
    AKU->>Builder: rebuild affected aggregate generation
    Builder-->>AKU: files + stats + metadata
    AKU->>Writer: write temp files, sync, rename with retry
    AKU->>Writer: write index-meta.json last
    AKU->>Writer: remove pending marker
    AKU->>Lock: release locks
    AKU-->>Caller: stored record
```

`index-meta.json` is the commit marker for a coherent aggregate-index generation. A pending marker or metadata mismatch at startup triggers doctor behavior.

## Search Pipeline

```mermaid
flowchart LR
    Query["query object"] --> Normalize["normalize text, tags, keywords, phrases"]
    Normalize --> Compile["compile filters"]
    Compile --> Candidates["candidate generation from postings"]
    Candidates --> HardFilters["apply hard filters"]
    HardFilters --> BM25F["classic BM25F lexical score"]
    BM25F --> Exact["bounded exact-match channel"]
    Exact --> Meta["status + weak recency modifiers"]
    Meta --> Diversity["maxResultsPerKU diversity"]
    Diversity --> Explain["matched_on + score_components"]
    Explain --> Results["search results"]
```

BM25F must combine field evidence per term before saturation. Exact matches are bounded side-channel signals, not uncapped additive score piles.

## ContextPack Flow

```mermaid
flowchart TB
    Search["search(query, broad limit)"] --> Ranked["ranked candidates"]
    Ranked --> Budget["estimate item character cost"]
    Budget --> MMR["MMR greedy selector"]
    MMR --> Quotas["enforce KU and record-type quotas"]
    Quotas --> Levels{"detail level?"}
    Levels -->|L1 default| L1["search-index fields only"]
    Levels -->|includeState| L2["load selected state.md"]
    Levels -->|explicit documents/results| L3["load selected details"]
    Levels -->|includeHistory explicitly| L4["load history.md"]
    L1 --> Pack["ContextPack"]
    L2 --> Pack
    L3 --> Pack
    L4 --> Pack
    Pack --> Explain["why_included + omitted summary"]
```

Redundancy is lexical and deterministic: same KU, title overlap, tag or keyword overlap, token Jaccard overlap, path ancestry, and repeated record type.

## Class Diagram

```mermaid
classDiagram
    class AgenticKnowledgeUnits {
        +constructor(options)
        +initAKU(metadata) Promise
        +loadAKU() Promise
        +exists() Promise~boolean~
        +initKU(metadata) Promise
        +loadKU(kuId) Promise
        +recordDocument(kuId, document) Promise
        +recordResult(kuId, result) Promise
        +recordEvent(kuId, event) Promise
        +registerFile(kuId, file) Promise
        +rebuildIndexes() Promise
        +doctor(options) Promise
        +search(query, options) Promise
        +buildContextPack(query, options) Promise
    }

    class AKUFileStore {
        +resolveRoot()
        +readJson(path)
        +writeJson(path, value)
        +readJsonl(path)
        +writeJsonl(path, records)
        +scanKUFolders()
        +resolveSafeRelativePath(input)
    }

    class AKULockManager {
        +acquire(scope, options)
        +refresh(lock)
        +release(lock)
        +isStale(lockPath)
    }

    class AtomicFileWriter {
        +transaction(label, callback)
        +replaceFile(path, content)
        +syncFile(handle)
        +renameWithRetry(temp, target)
        +syncParentDirectory(path)
    }

    class AKUIndexBuilder {
        +buildFromKUFolders()
        +buildSearchRecord(source)
        +buildStats(records)
        +buildIndexMeta(files)
    }

    class AKUTokenizer {
        +tokenizeField(value, field)
        +tokenizeQuery(query)
        +aliases(token)
        +extractPhrases(queryText)
    }

    class AKUSearchIndex {
        +load(records, stats)
        +candidateOrdinals(queryTerms)
        +getRecord(ordinal)
        +replace(records, stats)
    }

    class FilterCompiler {
        +compile(query, options)
        +matches(record)
    }

    class BM25FScorer {
        +score(record, queryTerms, stats)
        +scoreTerm(record, term, stats)
    }

    class ExactMatchScorer {
        +score(record, query)
        +explain(record, query)
    }

    class ContextPackBuilder {
        +build(query, options)
        +selectWithMMR(candidates, budget)
        +estimateChars(item)
        +renderItem(record, level)
    }

    class AKUDoctor {
        +validate()
        +checkPendingTransactions()
        +checkHashes()
        +rebuildIndexes()
        +report()
    }

    class AKUError {
        +code
        +message
        +details
    }

    AgenticKnowledgeUnits --> AKUFileStore
    AgenticKnowledgeUnits --> AKULockManager
    AgenticKnowledgeUnits --> AtomicFileWriter
    AgenticKnowledgeUnits --> AKUIndexBuilder
    AgenticKnowledgeUnits --> AKUSearchIndex
    AgenticKnowledgeUnits --> ContextPackBuilder
    AgenticKnowledgeUnits --> AKUDoctor

    AKUIndexBuilder --> AKUTokenizer
    AKUSearchIndex --> AKUTokenizer
    BM25FScorer --> AKUSearchIndex
    ContextPackBuilder --> BM25FScorer
    ContextPackBuilder --> ExactMatchScorer
    ContextPackBuilder --> FilterCompiler
    AKUDoctor --> AKUFileStore
    AtomicFileWriter --> AKUError
```

The facade owns orchestration. The collaborators remain small and interchangeable. This preserves a compact public API without collapsing all responsibilities into one class or one large implementation file.

## Design Decisions

```mermaid
flowchart TD
    D1["Need deterministic local memory"] --> A1["Filesystem-backed KU folders"]
    D2["Need fast search"] --> A2["Root aggregated JSONL indexes"]
    D3["Need readable and repairable storage"] --> A3["JSONL + checksums + doctor"]
    D4["Need structured relevance"] --> A4["Custom BM25F"]
    D5["Need exact technical terms"] --> A5["Bounded exact side channel"]
    D6["Need compact context"] --> A6["MMR ContextPack"]
    D7["Need cross-platform writes"] --> A7["mkdir locks + temp/sync/rename"]
    D8["Need future scale path"] --> A8["Persisted postings or SQLite adapter later"]
```

## V1 Guardrails

```mermaid
flowchart TB
    Guard["Before implementation starts"] --> G1["Use AgenticKnowledgeUnits path and export"]
    Guard --> G2["Classic BM25F, not per-field BM25 sum"]
    Guard --> G3["JSONL on disk plus in-memory postings"]
    Guard --> G4["Directory locks, not wx lockfiles"]
    Guard --> G5["Temp write, sync, rename, parent sync best effort"]
    Guard --> G6["index-meta.json checksums and generation id"]
    Guard --> G7["pending transaction markers"]
    Guard --> G8["doctor() recovery API"]
    Guard --> G9["MMR ContextPack selector"]
```

## Implementation Milestones

```mermaid
gantt
    title AKU Implementation Sequence
    dateFormat  YYYY-MM-DD
    axisFormat  %d
    section Foundations
    Module shell and package exports        :a1, 2026-05-18, 2d
    Types and public API tests              :a2, after a1, 2d
    section Storage
    Safe paths and schema validation        :b1, after a2, 3d
    Locks and atomic writer                 :b2, after b1, 4d
    section Indexing
    Rebuild aggregated JSONL indexes        :c1, after b2, 4d
    Checksums and doctor                    :c2, after c1, 3d
    section Retrieval
    Tokenizer and postings                  :d1, after c2, 4d
    BM25F and exact scoring                 :d2, after d1, 4d
    Search filters and explanations         :d3, after d2, 3d
    section Context
    ContextPack MMR selector                :e1, after d3, 4d
    Detail loading levels                   :e2, after e1, 3d
    section Hardening
    Corruption and recovery tests           :f1, after e2, 4d
    Benchmarks and docs update              :f2, after f1, 3d
```

The dates are sequencing anchors, not release commitments. The important constraint is dependency order: storage safety and rebuildability must land before ranking features depend on generated indexes.

## SOLID And DRY Mapping

```mermaid
mindmap
  root((AKU design))
    Single Responsibility
      Facade coordinates
      Store persists
      Index ranks
      Doctor repairs
    Open Closed
      Ranking strategy
      Tokenizer strategy
      Future backend adapter
    Liskov Substitution
      Scorers have stable score contracts
      Pack selectors have stable build contracts
    Interface Segregation
      Public facade is caller-facing
      Internal collaborators stay narrow
    Dependency Inversion
      Facade depends on behavior contracts
      Tests inject clock and filesystem fixtures
    DRY
      One path resolver
      One tokenizer
      One status policy
      One transaction helper
```

The implementation should avoid broad abstract base classes. In JavaScript, small composable objects with explicit method contracts are enough.

## Test Architecture

```mermaid
flowchart TB
    StorageTest["storage.test.mjs"] --> Atomic["atomic writes + JSONL"]
    StorageTest --> Paths["safe paths + dirs"]

    SearchTest["search.test.mjs"] --> Tokenizer["tokenizer aliases"]
    SearchTest --> Ranking["classic BM25F + exact caps"]
    SearchTest --> Filters["filters + status + recency"]

    IndexTest["indexing.test.mjs"] --> Rebuild["full rebuilds"]
    IndexTest --> Stats["stats + checksums + postings"]

    ContextTest["contextPack.test.mjs"] --> MMR["ContextPack MMR"]
    ContextTest --> Budget["char budget + quotas"]

    LifecycleTest["agenticKnowledgeUnits.test.mjs"] --> Lifecycle["public API lifecycle"]
    RecoveryTest["recovery.test.mjs"] --> Pending["pending transaction marker"]
    RecoveryTest --> Corrupt["corrupt JSONL/hash mismatch"]
    RecoveryTest --> Locks["stale lock cleanup"]
    SecurityTest["security.test.mjs"] --> Traversal["traversal + symlink rejection"]
    ExportTest["packageExports.test.mjs"] --> Package["root + subpath exports"]

    Bench["Benchmarks"] --> Load["cold load"]
    Bench --> Search["warm search"]
    Bench --> Pack["ContextPack"]
    Bench --> RebuildCost["rebuild cost"]
```

Filesystem tests should use temporary directories and should not write into repository `.aku` folders. Warm-process acceptance targets are: `search()` under 25 ms for typical 1,000-record filtered queries, under 200 ms for typical 10,000-record filtered queries, and L1 `buildContextPack()` under 100 ms after candidates are available.

## Migration Path

```mermaid
flowchart LR
    V1["v1 JSONL + in-memory postings"] --> V11["v1.1 persisted postings sidecar"]
    V11 --> V2["v2 optional SQLite FTS5 backend"]
    V1 --> Schema["schema migrations"]
    Schema --> StructuredFindings["structured reusable_findings"]
    Schema --> RichProvenance["richer provenance"]
    V2 --> Adapter["backend adapter strategy"]
    Adapter --> SameAPI["same public facade API"]
```

The migration rule is that KU folders and denormalized search records remain the source for rebuilding any optimized backend. Future backends must not become the only copy of user memory.
