export interface AgenticKnowledgeUnitsOptions {
    rootDir?: string;
    actor?: string;
    contextBudgetChars?: number;
    lockTimeoutMs?: number;
    staleLockMs?: number;
    lockRefreshMs?: number;
    strictFsync?: boolean;
    autoRepair?: boolean;
    allowSensitivePaths?: boolean;
    clock?: () => Date;
}

export interface AKUSearchOptions {
    limit?: number;
    maxResultsPerKU?: number;
    explain?: boolean;
    includeDiscarded?: boolean;
    includeObsolete?: boolean;
    audit?: boolean;
    recovery?: boolean;
    filters?: Record<string, unknown>;
    recordType?: string | string[];
    status?: string | string[];
    tags?: string | string[];
    kuId?: string | string[];
}

export interface ContextPackOptions extends AKUSearchOptions {
    budgetChars?: number;
    lambda?: number;
    candidateLimit?: number;
    includeState?: boolean;
    includeHistory?: boolean;
    quotas?: Record<string, number>;
}

export class AKUError extends Error {
    code: string;
    details: Record<string, unknown>;
}

export class AgenticKnowledgeUnits {
    constructor(options?: AgenticKnowledgeUnitsOptions);
    initAKU(metadata?: Record<string, unknown>): Promise<Record<string, unknown>>;
    loadAKU(options?: { autoRepair?: boolean; skipDoctor?: boolean }): Promise<Record<string, unknown>>;
    exists(): Promise<boolean>;

    initKU(metadata?: Record<string, unknown>): Promise<Record<string, unknown>>;
    loadKU(kuId: string): Promise<Record<string, unknown>>;
    updateKUState(kuId: string, update: string | Record<string, unknown>): Promise<Record<string, unknown>>;
    setKUStatus(kuId: string, status: string, reason?: string): Promise<Record<string, unknown>>;

    recordEvent(kuId: string, event?: Record<string, unknown>): Promise<Record<string, unknown>>;
    recordDocument(kuId: string, document?: Record<string, unknown>): Promise<Record<string, unknown>>;
    registerFile(kuId: string, file: Record<string, unknown>): Promise<Record<string, unknown>>;
    recordResult(kuId: string, result?: Record<string, unknown>): Promise<Record<string, unknown>>;
    recordRun(kuId: string, run?: Record<string, unknown>): Promise<Record<string, unknown>>;
    recordValidation(kuId: string, validation?: Record<string, unknown>): Promise<Record<string, unknown>>;

    ingestSession(kuId: string, packet?: Record<string, unknown>): Promise<Record<string, unknown>>;
    discardSession(kuId: string, sessionId: string, reason?: string): Promise<Record<string, unknown>>;

    forkKU(kuId: string, options?: Record<string, unknown>): Promise<Record<string, unknown>>;
    discardKU(kuId: string, reason?: string): Promise<Record<string, unknown>>;
    deleteKU(kuId: string, options?: { confirm?: boolean }): Promise<Record<string, unknown>>;

    updateIndexes(): Promise<Record<string, unknown>>;
    rebuildIndexes(): Promise<Record<string, unknown>>;
    doctor(options?: Record<string, unknown>): Promise<Record<string, unknown>>;

    search(query: string | Record<string, unknown>, options?: AKUSearchOptions): Promise<Record<string, unknown>>;
    buildContextPack(query: string | Record<string, unknown>, options?: ContextPackOptions): Promise<Record<string, unknown>>;

    listKUs(filter?: Record<string, unknown>): Promise<Record<string, unknown>[]>;
    listDocuments(filter?: Record<string, unknown>): Promise<Record<string, unknown>[]>;
    listFiles(filter?: Record<string, unknown>): Promise<Record<string, unknown>[]>;
    listResults(filter?: Record<string, unknown>): Promise<Record<string, unknown>[]>;
}

export default AgenticKnowledgeUnits;
