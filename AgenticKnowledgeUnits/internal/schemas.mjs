import { createHash, randomBytes } from 'node:crypto';
import {
    AKU_SCHEMA_VERSION,
    KU_LINK_RELATIONS,
    RECORD_TYPES,
    SENSITIVE_FIELD_NAMES,
    STATUSES,
} from './constants.mjs';
import { AKU_ERROR_CODES, AKUError } from './errors.mjs';

export function isoNow(clock = () => new Date()) {
    const value = clock();
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function stableTimestampForId(date = new Date()) {
    return date.toISOString()
        .replace(/[-:]/g, '')
        .replace(/\.\d{3}Z$/, '')
        .replace('T', '_')
        .toLowerCase();
}

export function generateId(prefix, clock = () => new Date()) {
    return `${prefix}_${stableTimestampForId(clock())}_${randomBytes(4).toString('hex')}`;
}

export function sha256(content) {
    return createHash('sha256').update(content).digest('hex');
}

export function sha256Object(value) {
    return sha256(stableStringify(value));
}

export function stableStringify(value) {
    return JSON.stringify(sortForStringify(value));
}

function sortForStringify(value) {
    if (Array.isArray(value)) {
        return value.map(sortForStringify);
    }
    if (!value || typeof value !== 'object') {
        return value;
    }
    const sorted = {};
    for (const key of Object.keys(value).sort()) {
        sorted[key] = sortForStringify(value[key]);
    }
    return sorted;
}

export function asArray(value) {
    if (value === undefined || value === null) {
        return [];
    }
    if (Array.isArray(value)) {
        return value.filter(item => item !== undefined && item !== null);
    }
    return [value];
}

export function cleanString(value, fallback = '') {
    if (value === undefined || value === null) {
        return fallback;
    }
    return String(value);
}

export function normalizeStatus(status = 'active') {
    const normalized = String(status || 'active').trim().toLowerCase();
    if (!STATUSES.includes(normalized)) {
        throw new AKUError(
            AKU_ERROR_CODES.AKU_INVALID_STATUS,
            `Invalid AKU status: ${status}`,
            { status },
        );
    }
    return normalized;
}

export function validateKuId(kuId) {
    if (!/^ku_[a-z0-9][a-z0-9_-]*$/i.test(String(kuId || ''))) {
        throw new AKUError(
            AKU_ERROR_CODES.AKU_SCHEMA_ERROR,
            `Invalid KU id: ${kuId}`,
            { kuId },
        );
    }
    return String(kuId);
}

export function normalizeKULinkRelation(relation = 'references') {
    const normalized = String(relation || 'references').trim().toLowerCase();
    if (!KU_LINK_RELATIONS.includes(normalized)) {
        throw new AKUError(
            AKU_ERROR_CODES.AKU_SCHEMA_ERROR,
            `Invalid KU link relation: ${relation}`,
            { relation },
        );
    }
    return normalized;
}

export function normalizeRecordId(prefix, value, clock) {
    if (value) {
        const normalized = String(value);
        if (!/^[a-z][a-z0-9]*_[a-z0-9][a-z0-9_-]*$/i.test(normalized)) {
            throw new AKUError(
                AKU_ERROR_CODES.AKU_SCHEMA_ERROR,
                `Invalid record id: ${value}`,
                { value },
            );
        }
        return normalized;
    }
    return generateId(prefix, clock);
}

export function createAKUMetadata(metadata = {}, options = {}) {
    const now = isoNow(options.clock);
    return {
        schema: AKU_SCHEMA_VERSION,
        created_at: now,
        updated_at: now,
        ku_root_version: 0,
        actor: options.actor ?? metadata.actor ?? null,
        metadata: stripUndefined(metadata),
    };
}

export function createManifest(metadata = {}, options = {}) {
    const now = isoNow(options.clock);
    const kuId = metadata.ku_id ? validateKuId(metadata.ku_id) : generateId('ku', options.clock);
    return {
        schema: AKU_SCHEMA_VERSION,
        ku_id: kuId,
        ku_name: cleanString(metadata.ku_name ?? metadata.title ?? kuId, kuId),
        ku_type: cleanString(metadata.ku_type ?? metadata.type ?? 'knowledge_unit', 'knowledge_unit'),
        status: normalizeStatus(metadata.status ?? 'active'),
        created_at: metadata.created_at ?? now,
        updated_at: metadata.updated_at ?? now,
        version: Number.isInteger(metadata.version) ? metadata.version : 1,
        tags: asArray(metadata.tags).map(String),
        keywords: asArray(metadata.keywords).map(String),
        summary: cleanString(metadata.summary),
        reusable_findings: normalizeReusableFindings(metadata.reusable_findings),
        lineage: normalizeLineage(metadata.lineage, metadata.parent_ku_id),
        parent_ku_id: metadata.parent_ku_id ?? null,
        outcome_status: metadata.outcome_status ?? null,
        created_by: metadata.created_by ?? options.actor ?? null,
        updated_by: metadata.updated_by ?? options.actor ?? null,
        actor: metadata.actor ?? options.actor ?? null,
        source_operation: metadata.source_operation ?? null,
    };
}

export function touchManifest(manifest, updates = {}, options = {}) {
    const next = {
        ...manifest,
        ...updates,
        updated_at: updates.updated_at ?? isoNow(options.clock),
        updated_by: updates.updated_by ?? options.actor ?? manifest.updated_by ?? null,
        version: Number(manifest.version || 0) + 1,
    };
    next.status = normalizeStatus(next.status);
    next.tags = asArray(next.tags).map(String);
    next.keywords = asArray(next.keywords).map(String);
    next.reusable_findings = normalizeReusableFindings(next.reusable_findings);
    next.lineage = normalizeLineage(next.lineage, next.parent_ku_id);
    return next;
}

export function normalizeLineage(lineage, parentKuId) {
    if (lineage && typeof lineage === 'object' && !Array.isArray(lineage)) {
        return {
            ...lineage,
            parent_ku_id: lineage.parent_ku_id ?? parentKuId ?? null,
        };
    }
    return {
        parent_ku_id: parentKuId ?? null,
        forked_from: parentKuId ?? null,
    };
}

export function normalizeReusableFindings(value) {
    return asArray(value).map((item) => {
        if (item && typeof item === 'object') {
            return stripUndefined(item);
        }
        return String(item);
    });
}

export function reusableFindingsText(value) {
    return normalizeReusableFindings(value).map((item) => {
        if (item && typeof item === 'object') {
            return [
                item.title,
                item.summary,
                item.text,
                item.finding,
                item.status,
            ].filter(Boolean).join(' ');
        }
        return String(item);
    }).filter(Boolean);
}

export function stripUndefined(value) {
    if (Array.isArray(value)) {
        return value.map(stripUndefined).filter(item => item !== undefined);
    }
    if (!value || typeof value !== 'object') {
        return value === undefined ? undefined : value;
    }
    const out = {};
    for (const [key, child] of Object.entries(value)) {
        if (child !== undefined) {
            out[key] = stripUndefined(child);
        }
    }
    return out;
}

export function stripSensitiveFields(value) {
    if (Array.isArray(value)) {
        return value.map(stripSensitiveFields);
    }
    if (!value || typeof value !== 'object') {
        return value;
    }
    const out = {};
    for (const [key, child] of Object.entries(value)) {
        const normalizedKey = key.toLowerCase().replace(/[-\s]/g, '_');
        if (SENSITIVE_FIELD_NAMES.has(normalizedKey)) {
            continue;
        }
        out[key] = stripSensitiveFields(child);
    }
    return out;
}

export function normalizeEvent(event = {}, context = {}) {
    const now = isoNow(context.clock);
    return stripUndefined({
        event_id: normalizeRecordId('evt', event.event_id ?? event.id, context.clock),
        ku_id: context.kuId,
        record_type: RECORD_TYPES.event,
        event_type: event.event_type ?? event.type ?? 'event',
        status: normalizeStatus(event.status ?? 'active'),
        title: cleanString(event.title ?? event.event_type ?? event.type ?? 'event'),
        summary: cleanString(event.summary ?? event.message ?? event.reason),
        reason: event.reason ?? null,
        tags: asArray(event.tags).map(String),
        keywords: asArray(event.keywords).map(String),
        created_at: event.created_at ?? now,
        updated_at: event.updated_at ?? event.created_at ?? now,
        actor: event.actor ?? context.actor ?? null,
        metadata: stripSensitiveFields(event.metadata ?? {}),
    });
}

export function normalizeDocument(document = {}, context = {}) {
    const now = isoNow(context.clock);
    return stripUndefined({
        document_id: normalizeRecordId('doc', document.document_id ?? document.id, context.clock),
        ku_id: context.kuId,
        record_type: RECORD_TYPES.document,
        document_type: document.document_type ?? document.type ?? 'document',
        status: normalizeStatus(document.status ?? 'active'),
        title: cleanString(document.title ?? document.name ?? 'document'),
        summary: cleanString(document.summary ?? document.description),
        tags: asArray(document.tags).map(String),
        keywords: asArray(document.keywords).map(String),
        reusable_findings: normalizeReusableFindings(document.reusable_findings),
        path: document.path ?? null,
        created_at: document.created_at ?? now,
        updated_at: document.updated_at ?? document.created_at ?? now,
        actor: document.actor ?? context.actor ?? null,
        metadata: stripSensitiveFields(document.metadata ?? {}),
    });
}

export function normalizeFileRecord(file = {}, context = {}) {
    const now = isoNow(context.clock);
    return stripUndefined({
        file_id: normalizeRecordId('file', file.file_id ?? file.id, context.clock),
        ku_id: context.kuId,
        record_type: RECORD_TYPES.file,
        file_type: file.file_type ?? file.type ?? 'file',
        role: file.role ?? null,
        status: normalizeStatus(file.status ?? 'active'),
        title: cleanString(file.title ?? file.path ?? 'file'),
        summary: cleanString(file.summary ?? file.description),
        path: file.path,
        tags: asArray(file.tags).map(String),
        keywords: asArray(file.keywords).map(String),
        hash: file.hash ?? null,
        size: file.size ?? null,
        mime_type: file.mime_type ?? file.mimeType ?? null,
        mtime: file.mtime ?? null,
        created_at: file.created_at ?? now,
        updated_at: file.updated_at ?? file.created_at ?? now,
        actor: file.actor ?? context.actor ?? null,
        metadata: stripSensitiveFields(file.metadata ?? {}),
    });
}

export function normalizeKULink(link = {}, context = {}) {
    const now = isoNow(context.clock);
    const sourceKuId = validateKuId(link.source_ku_id ?? link.sourceKuId ?? context.kuId);
    const targetKuId = validateKuId(link.target_ku_id ?? link.targetKuId);
    if (sourceKuId === targetKuId && link.allow_self !== true && link.allowSelf !== true) {
        throw new AKUError(
            AKU_ERROR_CODES.AKU_SCHEMA_ERROR,
            'KU links must point at a different KU',
            { sourceKuId, targetKuId },
        );
    }
    const relation = normalizeKULinkRelation(link.relation ?? link.type);
    return stripUndefined({
        link_id: normalizeRecordId('link', link.link_id ?? link.id, context.clock),
        ku_id: sourceKuId,
        source_ku_id: sourceKuId,
        target_ku_id: targetKuId,
        record_type: RECORD_TYPES.link,
        relation,
        status: normalizeStatus(link.status ?? 'active'),
        title: cleanString(link.title ?? `${relation} ${targetKuId}`),
        summary: cleanString(link.summary ?? link.description ?? link.reason),
        reason: link.reason ?? null,
        tags: asArray(link.tags).map(String),
        keywords: asArray(link.keywords).map(String),
        created_at: link.created_at ?? now,
        updated_at: link.updated_at ?? link.created_at ?? now,
        actor: link.actor ?? context.actor ?? null,
        metadata: stripSensitiveFields(link.metadata ?? {}),
    });
}

export function normalizeResult(result = {}, context = {}) {
    const now = isoNow(context.clock);
    return stripUndefined({
        result_id: normalizeRecordId('res', result.result_id ?? result.run_id ?? result.validation_id ?? result.id, context.clock),
        ku_id: context.kuId,
        record_type: RECORD_TYPES.result,
        result_type: result.result_type ?? result.type ?? 'result',
        status: normalizeStatus(result.status ?? result.outcome_status ?? 'active'),
        outcome_status: result.outcome_status ?? null,
        title: cleanString(result.title ?? result.name ?? result.result_type ?? result.type ?? 'result'),
        summary: cleanString(result.summary ?? result.description ?? result.message),
        tags: asArray(result.tags).map(String),
        keywords: asArray(result.keywords).map(String),
        reusable_findings: normalizeReusableFindings(result.reusable_findings),
        created_at: result.created_at ?? now,
        updated_at: result.updated_at ?? result.created_at ?? now,
        actor: result.actor ?? context.actor ?? null,
        metadata: stripSensitiveFields(result.metadata ?? {}),
    });
}

export function normalizeSession(packet = {}, context = {}) {
    const now = isoNow(context.clock);
    return stripUndefined({
        session_id: packet.session_id ?? packet.sessionId ?? normalizeRecordId('sess', packet.id, context.clock),
        ku_id: context.kuId,
        status: normalizeStatus(packet.status ?? 'active'),
        title: cleanString(packet.title ?? packet.session_id ?? packet.sessionId ?? 'session'),
        summary: cleanString(packet.summary ?? packet.description),
        created_at: packet.created_at ?? now,
        updated_at: packet.updated_at ?? packet.created_at ?? now,
        actor: packet.actor ?? context.actor ?? null,
        metadata: stripSensitiveFields(packet.metadata ?? {}),
    });
}
