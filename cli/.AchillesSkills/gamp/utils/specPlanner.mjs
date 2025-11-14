import GampRSP from '../../../GampRSP.mjs';

const DEFAULT_SUMMARY_LIMIT = 12_000;

const normaliseId = (value) => (typeof value === 'string' ? value.trim().toUpperCase() : '');

export const ensureLLM = (context) => {
    if (context?.llmAgent && typeof context.llmAgent.executePrompt === 'function') {
        return context.llmAgent;
    }
    throw new Error('LLM agent is required but not provided in context.llmAgent.');
};

export const summariseSpecs = (limit = DEFAULT_SUMMARY_LIMIT) => {
    const snapshot = GampRSP.loadSpecs('');
    if (snapshot.length <= limit) {
        return snapshot;
    }
    return `${snapshot.slice(0, limit)}\n...\n(truncated)`;
};

export const parsePlan = (raw) => {
    if (!raw) {
        return [];
    }
    if (Array.isArray(raw)) {
        return raw;
    }
    if (typeof raw === 'object' && Array.isArray(raw.actions)) {
        return raw.actions;
    }
    if (typeof raw === 'string') {
        try {
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }
    return [];
};

const applyAction = (step) => {
    const payload = step || {};
    const action = typeof payload.action === 'string' ? payload.action.trim().toLowerCase() : '';
    switch (action) {
    case 'createurs':
        return { action, id: GampRSP.createURS(payload.title || 'New URS', payload.description || '') };
    case 'updateurs':
        GampRSP.updateURS(payload.id, payload.title || 'Updated URS', payload.description || '');
        return { action, id: normaliseId(payload.id) };
    case 'retireurs':
        GampRSP.retireURS(payload.id);
        return { action, id: normaliseId(payload.id) };
    case 'createfs': {
        const id = GampRSP.createFS(payload.title || 'New FS', payload.description || '', payload.ursId || null, payload.reqId || null);
        return { action, id };
    }
    case 'updatefs':
        GampRSP.updateFS(payload.id, payload.title || 'Updated FS', payload.description || '', payload.ursId || null);
        return { action, id: normaliseId(payload.id) };
    case 'createnfs': {
        const id = GampRSP.createNFS(payload.title || 'New NFS', payload.description || '', payload.ursId || null, payload.reqId || null);
        return { action, id };
    }
    case 'updatenfs':
        GampRSP.updateNFS(payload.id, payload.title || 'Updated NFS', payload.description || '', payload.ursId || null);
        return { action, id: normaliseId(payload.id) };
    case 'createds': {
        const id = GampRSP.createDS(
            payload.title || 'New DS',
            payload.description || '',
            payload.architecture || '',
            payload.ursId || null,
            payload.reqId || null,
        );
        return { action, id };
    }
    case 'updateds':
        GampRSP.updateDS(payload.id, payload.title || '', payload.description || '', payload.architecture || '');
        return { action, id: normaliseId(payload.id) };
    case 'createtest': {
        const testId = GampRSP.createTest(payload.dsId, payload.title || 'New test', payload.description || '');
        return { action, id: normaliseId(testId), dsId: normaliseId(payload.dsId) };
    }
    case 'deletetest':
        GampRSP.deleteTest(payload.id);
        return { action, id: normaliseId(payload.id) };
    case 'describefile':
        GampRSP.describeFile(
            payload.dsId,
            payload.filePath,
            payload.description || '',
            Array.isArray(payload.exports) ? payload.exports : [],
            Array.isArray(payload.dependencies) ? payload.dependencies : [],
            {
                why: payload.why,
                how: payload.how,
                what: payload.what,
                sideEffects: payload.sideEffects,
                concurrency: payload.concurrency,
            },
        );
        return { action, id: normaliseId(payload.dsId), filePath: payload.filePath };
    default:
        return { action: 'ignored', reason: `Unsupported action "${payload.action}"` };
    }
};

export const executePlan = (plan = []) => {
    const outcomes = [];
    plan.forEach((step) => {
        try {
            outcomes.push(applyAction(step));
        } catch (error) {
            outcomes.push({
                action: step?.action || 'unknown',
                error: error.message,
            });
        }
    });
    return outcomes;
};

export default {
    ensureLLM,
    summariseSpecs,
    parsePlan,
    executePlan,
};
