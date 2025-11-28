import fs from 'node:fs';

export const isTruthy = (value) => {
    if (typeof value === 'boolean') {
        return value;
    }
    if (typeof value !== 'string') {
        return false;
    }
    const normalized = value.trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes';
};

export const ensureArray = (value) => {
    if (Array.isArray(value)) {
        return value.filter(Boolean);
    }
    if (!value) {
        return [];
    }
    return String(value)
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);
};

export const detectImplementation = (skillRecord) => {
    const directory = skillRecord.skillDir;
    if (!directory || !fs.existsSync(directory)) {
        return 'unknown';
    }
    const entries = fs.readdirSync(directory);

    const hasJs = entries.some((entry) => entry.toLowerCase().endsWith('.js') || entry.toLowerCase().endsWith('.mjs'));
    const sopEntries = entries.filter((entry) => entry.toLowerCase().endsWith('.sop'));

    if (hasJs && sopEntries.length) {
        return 'javascript + soplang';
    }
    if (hasJs) {
        return 'javascript';
    }
    if (sopEntries.length) {
        return 'soplang';
    }

    const descriptorBody = skillRecord.descriptor?.body || '';
    if (/^#!english/m.test(descriptorBody)) {
        return 'english';
    }
    return 'descriptor-only';
};

const tryParsePlan = (payload) => {
    if (!payload) {
        return null;
    }
    if (Array.isArray(payload)) {
        return payload;
    }
    if (typeof payload === 'object') {
        if (Array.isArray(payload.steps)) {
            return payload.steps;
        }
        if (Array.isArray(payload.plan)) {
            return payload.plan;
        }
    }
    if (typeof payload === 'string') {
        const trimmed = payload.trim();
        const fenceMatch = trimmed.match(/^```[a-zA-Z]*\s*([\s\S]*?)```$/);
        const body = fenceMatch ? fenceMatch[1].trim() : trimmed;
        if (!body) {
            return null;
        }
        try {
            return tryParsePlan(JSON.parse(body));
        } catch {
            return null;
        }
    }
    return null;
};

export const parsePlan = (raw) => {
    const parsed = tryParsePlan(raw);
    if (parsed && parsed.length) {
        return parsed
            .map((entry) => ({
                skill: typeof entry.skill === 'string' ? entry.skill.trim() : '',
                prompt: typeof entry.prompt === 'string' ? entry.prompt.trim() : '',
            }))
            .filter((entry) => entry.skill && entry.prompt);
    }
    return [];
};

export default {
    isTruthy,
    ensureArray,
    detectImplementation,
    parsePlan,
};
