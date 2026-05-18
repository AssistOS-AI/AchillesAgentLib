import fs from 'node:fs/promises';
import path from 'node:path';
import { AtomicFileWriter } from './internal/atomic-write.mjs';
import {
    KU_FILES,
    ROOT_FILES,
} from './internal/constants.mjs';
import { AKUDoctor } from './internal/doctor.mjs';
import { AKU_ERROR_CODES, AKUError } from './internal/errors.mjs';
import { AKUIndexBuilder } from './internal/indexing.mjs';
import { AKULockManager } from './internal/locking.mjs';
import { FilterCompiler, AKUSearchIndex } from './internal/ranking.mjs';
import {
    createAKUMetadata,
    createManifest,
    isoNow,
    normalizeDocument,
    normalizeEvent,
    normalizeFileRecord,
    normalizeResult,
    normalizeSession,
    normalizeStatus,
    touchManifest,
    validateKuId,
} from './internal/schemas.mjs';
import { AKUFileStore } from './internal/storage.mjs';
import { ContextPackBuilder } from './internal/context-pack.mjs';
import { AKUTokenizer } from './internal/tokenizer.mjs';

export class AgenticKnowledgeUnits {
    constructor(options = {}) {
        this.rootDir = options.rootDir ?? process.cwd();
        this.actor = options.actor ?? 'unknown';
        this.contextBudgetChars = options.contextBudgetChars;
        this.clock = options.clock ?? (() => new Date());
        this.autoRepair = Boolean(options.autoRepair);

        this.store = new AKUFileStore({
            rootDir: this.rootDir,
            allowSensitivePaths: options.allowSensitivePaths,
        });
        this.tokenizer = new AKUTokenizer();
        this.lockManager = new AKULockManager({
            akuRoot: this.store.akuRoot,
            actor: this.actor,
            clock: this.clock,
            timeoutMs: options.lockTimeoutMs,
            staleMs: options.staleLockMs,
            refreshMs: options.lockRefreshMs,
        });
        this.writer = new AtomicFileWriter({
            akuRoot: this.store.akuRoot,
            actor: this.actor,
            clock: this.clock,
            strictFsync: options.strictFsync,
        });
        this.indexBuilder = new AKUIndexBuilder({
            store: this.store,
            tokenizer: this.tokenizer,
            clock: this.clock,
        });
        this.searchIndex = new AKUSearchIndex({ tokenizer: this.tokenizer });
        this.contextPackBuilder = new ContextPackBuilder({
            search: (query, searchOptions) => this.search(query, searchOptions),
            loadDetails: (record, detailOptions) => this.loadRecordDetails(record, detailOptions),
            clock: this.clock,
            contextBudgetChars: this.contextBudgetChars,
        });
        this.loaded = false;
        this.akuConfig = null;
        this.indexMeta = null;
    }

    async initAKU(metadata = {}) {
        await this.store.ensureBaseLayout();
        if (await this.exists()) {
            throw new AKUError(AKU_ERROR_CODES.AKU_ALREADY_EXISTS, 'AKU has already been initialized', {
                rootDir: this.rootDir,
            });
        }
        const lock = await this.lockManager.acquire('root', { label: 'initAKU' });
        try {
            const akuConfig = createAKUMetadata(metadata, {
                actor: this.actor,
                clock: this.clock,
            });
            const result = await this.writer.transaction('initAKU', async (tx) => {
                await tx.writeJson(this.store.rootFile(ROOT_FILES.aku), akuConfig);
                await this.writeAggregateIndexes(tx, akuConfig);
                return akuConfig;
            });
            await this.loadAKU({ skipDoctor: true });
            return result;
        } finally {
            await this.lockManager.release(lock);
        }
    }

    async loadAKU(options = {}) {
        if (!(await this.exists())) {
            throw new AKUError(AKU_ERROR_CODES.AKU_NOT_FOUND, 'AKU has not been initialized', {
                rootDir: this.rootDir,
            });
        }
        if (!options.skipDoctor) {
            await this.newDoctor().assertHealthy({
                autoRepair: options.autoRepair ?? this.autoRepair,
            });
        }
        return this.loadFromIndexes();
    }

    async exists() {
        return this.store.exists();
    }

    async initKU(metadata = {}) {
        await this.ensureAKU();
        const manifest = createManifest(metadata, {
            actor: this.actor,
            clock: this.clock,
        });
        let kuLock;
        const rootLock = await this.lockManager.acquire('root', { label: 'initKU' });
        try {
            try {
                await fs.stat(this.store.kuDir(manifest.ku_id));
                throw new AKUError(AKU_ERROR_CODES.AKU_ALREADY_EXISTS, `KU already exists: ${manifest.ku_id}`, {
                    kuId: manifest.ku_id,
                });
            } catch (error) {
                if (error instanceof AKUError) {
                    throw error;
                }
                if (error?.code !== 'ENOENT') {
                    throw error;
                }
            }
            await this.store.ensureKULayout(manifest.ku_id);
            kuLock = await this.lockManager.acquire('ku', {
                kuId: manifest.ku_id,
                label: 'initKU',
            });
            await this.writer.transaction('initKU', async (tx) => {
                await this.writeNewKUSource(tx, manifest, {
                    state: metadata.state ?? '',
                    history: metadata.history ?? '',
                    documents: [],
                    files: [],
                    results: [],
                    events: [
                        normalizeEvent({
                            event_type: 'ku_initialized',
                            title: 'KU initialized',
                            summary: manifest.summary,
                            tags: manifest.tags,
                            keywords: manifest.keywords,
                        }, this.contextFor(manifest.ku_id)),
                    ],
                    sessions: [],
                });
                const akuConfig = await this.touchAKU(tx);
                await this.writeAggregateIndexes(tx, akuConfig);
            });
            await this.loadAKU({ skipDoctor: true });
            return manifest;
        } finally {
            if (kuLock) {
                await this.lockManager.release(kuLock);
            }
            await this.lockManager.release(rootLock);
        }
    }

    async loadKU(kuId) {
        validateKuId(kuId);
        await this.ensureAKU();
        try {
            return await this.store.loadKU(kuId);
        } catch (error) {
            if (error?.code === 'ENOENT') {
                throw new AKUError(AKU_ERROR_CODES.AKU_NOT_FOUND, `KU not found: ${kuId}`, { kuId });
            }
            throw error;
        }
    }

    async updateKUState(kuId, update = {}) {
        validateKuId(kuId);
        const updateObject = typeof update === 'string' ? { state: update } : update;
        let updatedManifest;
        await this.withKUTransaction(kuId, 'updateKUState', async (tx) => {
            const ku = await this.store.loadKU(kuId);
            const state = updateObject.append
                ? `${ku.state}${ku.state.endsWith('\n') || !ku.state ? '' : '\n'}${updateObject.append}`
                : (updateObject.state ?? ku.state);
            updatedManifest = touchManifest(ku.manifest, {
                summary: updateObject.summary ?? ku.manifest.summary,
                tags: updateObject.tags ?? ku.manifest.tags,
                keywords: updateObject.keywords ?? ku.manifest.keywords,
                reusable_findings: updateObject.reusable_findings ?? ku.manifest.reusable_findings,
            }, this.contextFor(kuId));
            await tx.writeJson(this.store.kuFile(kuId, KU_FILES.manifest), updatedManifest);
            await tx.replaceFile(this.store.kuFile(kuId, KU_FILES.state), `${state}${state.endsWith('\n') || !state ? '' : '\n'}`);
            await this.appendKUJsonl(tx, kuId, KU_FILES.events, normalizeEvent({
                event_type: 'state_updated',
                title: 'State updated',
                summary: updateObject.reason ?? updateObject.summary ?? '',
            }, this.contextFor(kuId)));
        });
        return updatedManifest;
    }

    async setKUStatus(kuId, status, reason = '') {
        validateKuId(kuId);
        const normalizedStatus = normalizeStatus(status);
        let updatedManifest;
        await this.withKUTransaction(kuId, 'setKUStatus', async (tx) => {
            const ku = await this.store.loadKU(kuId);
            const event = normalizeEvent({
                event_type: 'status_changed',
                title: `Status changed to ${normalizedStatus}`,
                summary: reason,
                reason,
                status: 'active',
            }, this.contextFor(kuId));
            updatedManifest = touchManifest(ku.manifest, {
                status: normalizedStatus,
                last_event_id: event.event_id,
            }, this.contextFor(kuId));
            await tx.writeJson(this.store.kuFile(kuId, KU_FILES.manifest), updatedManifest);
            await this.appendKUJsonl(tx, kuId, KU_FILES.events, event);
        });
        return updatedManifest;
    }

    async recordEvent(kuId, event = {}) {
        validateKuId(kuId);
        const record = normalizeEvent(event, this.contextFor(kuId));
        await this.withKUTransaction(kuId, 'recordEvent', async (tx) => {
            const ku = await this.store.loadKU(kuId);
            const manifest = touchManifest(ku.manifest, {
                last_event_id: record.event_id,
            }, this.contextFor(kuId));
            await this.appendKUJsonl(tx, kuId, KU_FILES.events, record);
            await tx.writeJson(this.store.kuFile(kuId, KU_FILES.manifest), manifest);
        });
        return record;
    }

    async recordDocument(kuId, document = {}) {
        validateKuId(kuId);
        const safeDocument = { ...document };
        if (safeDocument.path) {
            const described = await this.store.describeProjectFile(safeDocument.path);
            safeDocument.path = described.path;
        }
        const record = normalizeDocument(safeDocument, this.contextFor(kuId));
        await this.withKUTransaction(kuId, 'recordDocument', async (tx) => {
            const ku = await this.store.loadKU(kuId);
            const manifest = touchManifest(ku.manifest, {
                last_document_id: record.document_id,
            }, this.contextFor(kuId));
            await this.appendKUJsonl(tx, kuId, KU_FILES.documents, record);
            await tx.writeJson(this.store.kuFile(kuId, KU_FILES.manifest), manifest);
        });
        return record;
    }

    async registerFile(kuId, file = {}) {
        validateKuId(kuId);
        const described = await this.store.describeProjectFile(file.path);
        const record = normalizeFileRecord({
            ...file,
            ...described,
        }, this.contextFor(kuId));
        await this.withKUTransaction(kuId, 'registerFile', async (tx) => {
            const ku = await this.store.loadKU(kuId);
            const manifest = touchManifest(ku.manifest, {
                last_file_id: record.file_id,
            }, this.contextFor(kuId));
            await this.appendKUJsonl(tx, kuId, KU_FILES.files, record);
            await tx.writeJson(this.store.kuFile(kuId, KU_FILES.manifest), manifest);
        });
        return record;
    }

    async recordResult(kuId, result = {}) {
        validateKuId(kuId);
        const record = normalizeResult(result, this.contextFor(kuId));
        await this.storeResultRecord(kuId, record, 'recordResult');
        return record;
    }

    async recordRun(kuId, run = {}) {
        validateKuId(kuId);
        const record = normalizeResult({
            ...run,
            result_id: run.result_id ?? run.run_id ?? run.id,
            result_type: run.result_type ?? 'run',
        }, this.contextFor(kuId));
        await this.storeResultRecord(kuId, record, 'recordRun');
        return record;
    }

    async recordValidation(kuId, validation = {}) {
        validateKuId(kuId);
        const record = normalizeResult({
            ...validation,
            result_id: validation.result_id ?? validation.validation_id ?? validation.id,
            result_type: validation.result_type ?? 'validation',
        }, this.contextFor(kuId));
        await this.storeResultRecord(kuId, record, 'recordValidation');
        return record;
    }

    async ingestSession(kuId, packet = {}) {
        validateKuId(kuId);
        const session = normalizeSession(packet, this.contextFor(kuId));
        await this.withKUTransaction(kuId, 'ingestSession', async (tx) => {
            const ku = await this.store.loadKU(kuId);
            const manifest = touchManifest(ku.manifest, {
                last_session_id: session.session_id,
            }, this.contextFor(kuId));
            await this.appendKUJsonl(tx, kuId, KU_FILES.sessions, session);
            await this.appendKUJsonl(tx, kuId, KU_FILES.events, normalizeEvent({
                event_type: 'session_ingested',
                title: 'Session ingested',
                summary: session.summary,
            }, this.contextFor(kuId)));
            await tx.writeJson(this.store.kuFile(kuId, KU_FILES.manifest), manifest);
        });
        return session;
    }

    async discardSession(kuId, sessionId, reason = '') {
        validateKuId(kuId);
        let session;
        await this.withKUTransaction(kuId, 'discardSession', async (tx) => {
            const sessions = await this.store.readKUJsonl(kuId, KU_FILES.sessions, { allowMissing: true });
            const index = sessions.findIndex(item => item.session_id === sessionId);
            if (index === -1) {
                session = normalizeSession({
                    session_id: sessionId,
                    status: 'discarded',
                    summary: reason,
                }, this.contextFor(kuId));
                sessions.push(session);
            } else {
                session = {
                    ...sessions[index],
                    status: 'discarded',
                    discard_reason: reason,
                    updated_at: isoNow(this.clock),
                };
                sessions[index] = session;
            }
            await tx.writeJsonl(this.store.kuFile(kuId, KU_FILES.sessions), sessions);
            await this.appendKUJsonl(tx, kuId, KU_FILES.events, normalizeEvent({
                event_type: 'session_discarded',
                title: 'Session discarded',
                summary: reason,
            }, this.contextFor(kuId)));
        });
        return session;
    }

    async forkKU(kuId, options = {}) {
        validateKuId(kuId);
        await this.ensureAKU();
        const source = await this.loadKU(kuId);
        const manifest = createManifest({
            ...source.manifest,
            ...options.metadata,
            ku_id: options.ku_id,
            ku_name: options.ku_name ?? `${source.manifest.ku_name} fork`,
            status: options.status ?? 'active',
            parent_ku_id: kuId,
            lineage: {
                ...(source.manifest.lineage ?? {}),
                parent_ku_id: kuId,
                forked_from: kuId,
            },
            version: 1,
            created_at: undefined,
            updated_at: undefined,
        }, this.contextFor(kuId));

        let kuLock;
        const rootLock = await this.lockManager.acquire('root', { label: 'forkKU' });
        try {
            try {
                await fs.stat(this.store.kuDir(manifest.ku_id));
                throw new AKUError(AKU_ERROR_CODES.AKU_ALREADY_EXISTS, `KU already exists: ${manifest.ku_id}`, {
                    kuId: manifest.ku_id,
                });
            } catch (error) {
                if (error instanceof AKUError) {
                    throw error;
                }
                if (error?.code !== 'ENOENT') {
                    throw error;
                }
            }
            await this.store.ensureKULayout(manifest.ku_id);
            kuLock = await this.lockManager.acquire('ku', { kuId: manifest.ku_id, label: 'forkKU' });
            await this.writer.transaction('forkKU', async (tx) => {
                await this.writeNewKUSource(tx, manifest, {
                    state: options.includeState === false ? '' : source.state,
                    history: options.includeHistory ? source.history : '',
                    documents: options.includeRecords ? source.documents : [],
                    files: options.includeRecords ? source.files : [],
                    results: options.includeRecords ? source.results : [],
                    events: [
                        normalizeEvent({
                            event_type: 'ku_forked',
                            title: 'KU forked',
                            summary: `Forked from ${kuId}`,
                        }, this.contextFor(manifest.ku_id)),
                    ],
                    sessions: [],
                });
                const akuConfig = await this.touchAKU(tx);
                await this.writeAggregateIndexes(tx, akuConfig);
            });
            await this.loadAKU({ skipDoctor: true });
            return manifest;
        } finally {
            if (kuLock) {
                await this.lockManager.release(kuLock);
            }
            await this.lockManager.release(rootLock);
        }
    }

    async discardKU(kuId, reason = '') {
        return this.setKUStatus(kuId, 'discarded', reason);
    }

    async deleteKU(kuId, options = {}) {
        validateKuId(kuId);
        if (options.confirm !== true) {
            throw new AKUError(AKU_ERROR_CODES.AKU_SCHEMA_ERROR, 'deleteKU requires { confirm: true }', { kuId });
        }
        let deleted = false;
        await this.withKUTransaction(kuId, 'deleteKU', async () => {
            await fs.rm(this.store.kuDir(kuId), { recursive: true, force: true });
            deleted = true;
        }, { skipSourceExistenceCheck: true });
        return { ku_id: kuId, deleted };
    }

    async updateIndexes() {
        return this.rebuildIndexes();
    }

    async rebuildIndexes() {
        await this.ensureAKU();
        const result = await this.rebuildIndexesNoLoad();
        await this.loadAKU({ skipDoctor: true });
        return result;
    }

    async doctor(options = {}) {
        const report = await this.newDoctor().run(options);
        if (report.ok && await this.exists()) {
            await this.loadAKU({ skipDoctor: true });
        }
        return report;
    }

    async search(query, options = {}) {
        if (!this.loaded) {
            await this.loadAKU();
        }
        const queryModel = this.tokenizer.tokenizeQuery(query);
        return this.searchIndex.search(queryModel, options);
    }

    async buildContextPack(query, options = {}) {
        if (!this.loaded) {
            await this.loadAKU();
        }
        return this.contextPackBuilder.build(query, options);
    }

    async listKUs(filter = {}) {
        return this.listRecords('ku', filter);
    }

    async listDocuments(filter = {}) {
        return this.listRecords('document', filter);
    }

    async listFiles(filter = {}) {
        return this.listRecords('file', filter);
    }

    async listResults(filter = {}) {
        return this.listRecords('result', filter);
    }

    async listRecords(recordType, filter = {}) {
        if (!this.loaded) {
            await this.loadAKU();
        }
        const queryModel = this.tokenizer.tokenizeQuery('');
        const compiled = new FilterCompiler().compile(queryModel, {
            ...filter,
            recordType,
        });
        return this.searchIndex.records
            .filter(record => compiled.matches(record))
            .map(record => {
                const copy = {};
                for (const [key, value] of Object.entries(record)) {
                    if (!key.startsWith('__')) {
                        copy[key] = value;
                    }
                }
                return copy;
            });
    }

    async storeResultRecord(kuId, record, label) {
        await this.withKUTransaction(kuId, label, async (tx) => {
            const ku = await this.store.loadKU(kuId);
            const manifest = touchManifest(ku.manifest, {
                last_result_id: record.result_id,
            }, this.contextFor(kuId));
            await this.appendKUJsonl(tx, kuId, KU_FILES.results, record);
            await tx.writeJson(this.store.kuFile(kuId, KU_FILES.manifest), manifest);
        });
    }

    async ensureAKU() {
        if (!(await this.exists())) {
            throw new AKUError(AKU_ERROR_CODES.AKU_NOT_FOUND, 'AKU has not been initialized', {
                rootDir: this.rootDir,
            });
        }
    }

    async loadFromIndexes() {
        const akuConfig = await this.store.readRootJson(ROOT_FILES.aku);
        const indexMeta = await this.store.readRootJson(ROOT_FILES.indexMeta);
        const records = await this.store.readRootJsonl(ROOT_FILES.searchIndex);
        const stats = await this.store.readRootJson(ROOT_FILES.searchStats);
        if (indexMeta.record_counts?.search !== records.length) {
            throw new AKUError(AKU_ERROR_CODES.AKU_CORRUPT_INDEX, 'search-index.jsonl record count does not match index-meta.json', {
                expected: indexMeta.record_counts?.search,
                actual: records.length,
            });
        }
        if (stats.record_count !== records.length) {
            throw new AKUError(AKU_ERROR_CODES.AKU_CORRUPT_INDEX, 'search-stats.json record count does not match search-index.jsonl', {
                expected: stats.record_count,
                actual: records.length,
            });
        }
        this.searchIndex.load(records, stats);
        this.akuConfig = akuConfig;
        this.indexMeta = indexMeta;
        this.loaded = true;
        return akuConfig;
    }

    async rebuildIndexesNoLoad() {
        const lock = await this.lockManager.acquire('root', { label: 'rebuildIndexes' });
        try {
            return await this.writer.transaction('rebuildIndexes', async (tx) => {
                const akuConfig = await this.store.readRootJson(ROOT_FILES.aku);
                await this.writeAggregateIndexes(tx, akuConfig);
                return {
                    generation_id: (await this.store.readRootJson(ROOT_FILES.indexMeta)).generation_id,
                };
            });
        } finally {
            await this.lockManager.release(lock);
        }
    }

    async writeAggregateIndexes(tx, akuConfig) {
        const aggregate = await this.indexBuilder.buildFromKUFolders(akuConfig);
        const indexFileNames = Object.keys(aggregate.files).filter(name => name !== ROOT_FILES.indexMeta);
        for (const name of indexFileNames) {
            await tx.replaceFile(this.store.rootFile(name), aggregate.files[name]);
        }
        await tx.writeJson(this.store.rootFile(ROOT_FILES.indexMeta), aggregate.indexMeta);
        return aggregate.indexMeta;
    }

    async touchAKU(tx) {
        const current = await this.store.readRootJson(ROOT_FILES.aku);
        const next = {
            ...current,
            updated_at: isoNow(this.clock),
            ku_root_version: Number(current.ku_root_version ?? 0) + 1,
        };
        await tx.writeJson(this.store.rootFile(ROOT_FILES.aku), next);
        return next;
    }

    async withKUTransaction(kuId, label, callback, options = {}) {
        await this.ensureAKU();
        validateKuId(kuId);
        if (!options.skipSourceExistenceCheck) {
            try {
                await fs.stat(this.store.kuDir(kuId));
            } catch (error) {
                if (error?.code === 'ENOENT') {
                    throw new AKUError(AKU_ERROR_CODES.AKU_NOT_FOUND, `KU not found: ${kuId}`, { kuId });
                }
                throw error;
            }
        }
        const locks = await this.lockManager.acquireRootAndKU(kuId, label);
        try {
            const result = await this.writer.transaction(label, async (tx) => {
                const callbackResult = await callback(tx);
                const akuConfig = await this.touchAKU(tx);
                await this.writeAggregateIndexes(tx, akuConfig);
                return callbackResult;
            });
            await this.loadAKU({ skipDoctor: true });
            return result;
        } finally {
            await this.lockManager.releaseAll(locks);
        }
    }

    async writeNewKUSource(tx, manifest, source) {
        await tx.writeJson(this.store.kuFile(manifest.ku_id, KU_FILES.manifest), manifest);
        await tx.replaceFile(this.store.kuFile(manifest.ku_id, KU_FILES.state), source.state ?? '');
        await tx.replaceFile(this.store.kuFile(manifest.ku_id, KU_FILES.history), source.history ?? '');
        await tx.writeJsonl(this.store.kuFile(manifest.ku_id, KU_FILES.documents), source.documents ?? []);
        await tx.writeJsonl(this.store.kuFile(manifest.ku_id, KU_FILES.files), source.files ?? []);
        await tx.writeJsonl(this.store.kuFile(manifest.ku_id, KU_FILES.results), source.results ?? []);
        await tx.writeJsonl(this.store.kuFile(manifest.ku_id, KU_FILES.events), source.events ?? []);
        await tx.writeJsonl(this.store.kuFile(manifest.ku_id, KU_FILES.sessions), source.sessions ?? []);
    }

    async appendKUJsonl(tx, kuId, relativePath, record) {
        const records = await this.store.readKUJsonl(kuId, relativePath, { allowMissing: true });
        records.push(record);
        await tx.writeJsonl(this.store.kuFile(kuId, relativePath), records);
    }

    async loadRecordDetails(record, options = {}) {
        if (!record?.ku_id) {
            return {};
        }
        const details = {};
        if (options.includeState) {
            details.state = await this.store.readKUText(record.ku_id, KU_FILES.state, {
                allowMissing: true,
                defaultValue: '',
            });
        }
        if (options.includeHistory) {
            details.history = await this.store.readKUText(record.ku_id, KU_FILES.history, {
                allowMissing: true,
                defaultValue: '',
            });
        }
        return details;
    }

    contextFor(kuId) {
        return {
            kuId,
            actor: this.actor,
            clock: this.clock,
        };
    }

    newDoctor() {
        return new AKUDoctor({
            store: this.store,
            lockManager: this.lockManager,
            rebuildIndexes: () => this.rebuildIndexesNoLoad(),
        });
    }
}

export default AgenticKnowledgeUnits;
