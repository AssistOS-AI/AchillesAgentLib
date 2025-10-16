import { createFlexSearchAdapter } from '../search/flexsearchAdapter.mjs';

const CANCEL_KEYWORDS = new Set(['cancel', 'stop', 'abort', 'no thanks', 'never mind']);

const toComparable = (input) => {
    if (input === null || input === undefined) {
        return '';
    }
    if (typeof input === 'string') {
        return input.trim().toLowerCase();
    }
    if (typeof input === 'number' || typeof input === 'boolean') {
        return String(input).toLowerCase();
    }
    try {
        return JSON.stringify(input).toLowerCase();
    } catch (error) {
        return String(input).toLowerCase();
    }
};

const coerceByType = (rawValue, type) => {
    if (rawValue === null || rawValue === undefined || !type) {
        return rawValue;
    }
    const normalizedType = type.toLowerCase();
    if (normalizedType === 'boolean') {
        const token = toComparable(rawValue);
        if (['true', '1', 'yes', 'y'].includes(token)) {
            return true;
        }
        if (['false', '0', 'no', 'n'].includes(token)) {
            return false;
        }
    }
    if (normalizedType === 'integer' || normalizedType === 'number') {
        const numeric = Number(rawValue);
        if (Number.isFinite(numeric)) {
            return normalizedType === 'integer' ? Math.trunc(numeric) : numeric;
        }
    }

    if (typeof rawValue === 'string') {
        const trimmed = rawValue.trim();
        if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
            try {
                return JSON.parse(trimmed);
            } catch (error) {
                // ignore JSON parse errors
            }
        }
    }

    return rawValue;
};

const normalizeOptionEntries = (values = []) => {
    const entries = [];
    for (const entry of values) {
        if (entry === null || entry === undefined) {
            continue;
        }
        // Support rich entries: { value, label, description?, synonyms? }
        if (typeof entry === 'object' && Object.prototype.hasOwnProperty.call(entry, 'value')) {
            const label = entry.label === null || entry.label === undefined
                ? String(entry.value)
                : String(entry.label);
            const value = entry.value;
            const description = entry.description ? String(entry.description) : '';
            const synonyms = Array.isArray(entry.synonyms) ? entry.synonyms.filter(Boolean).map(String) : [];
            const labelToken = toComparable(label);
            const valueToken = toComparable(value);
            const synonymTokens = synonyms.map(toComparable).filter(Boolean);
            const allTokens = [labelToken, ...synonymTokens].filter(Boolean);
            entries.push({
                label,
                value,
                description,
                synonyms,
                labelToken,
                valueToken,
                allTokens,
            });
            continue;
        }
        const label = String(entry);
        const labelToken = toComparable(label);
        const valueToken = toComparable(entry);
        entries.push({
            label,
            value: entry,
            description: '',
            synonyms: [],
            labelToken,
            valueToken,
            allTokens: [labelToken],
        });
    }
    return entries;
};

function createOptionSearch(entries) {
    if (!entries.length) {
        return null;
    }
    const index = createFlexSearchAdapter({ tokenize: 'forward' });
    entries.forEach(entry => {
        // Index label and synonyms (allTokens)
        (entry.allTokens || [entry.labelToken]).forEach(tok => {
            if (tok) {
                index.add(tok, entry.label);
            }
        });
    });
    return index;
}

async function resolveOption(definition, rawValue, optionsByName, optionSearchIndex) {
    const entries = optionsByName.get(definition.name) || [];
    if (!entries.length) {
        return { matched: false };
    }

    const comparable = toComparable(rawValue);
    for (const entry of entries) {
        if (
            entry.labelToken === comparable ||
            entry.valueToken === comparable ||
            (Array.isArray(entry.allTokens) && entry.allTokens.includes(comparable))
        ) {
            return { matched: true, value: entry.value };
        }
    }

    const search = optionSearchIndex.get(definition.name);
    if (search) {
        try {
            const [best] = search.search(comparable, { limit: 1 }) || [];
            if (best) {
                const found = entries.find(entry => entry.label === best);
                if (found) {
                    return { matched: true, value: found.value };
                }
            }
        } catch (error) {
            // ignore search errors
        }
    }

    return { matched: false };
}

async function executeResolver(definition, rawValue, context) {
    if (typeof definition.resolver !== 'function') {
        return rawValue;
    }
    return definition.resolver(rawValue, { argument: definition.name, context });
}

async function validateValue(definition, value) {
    if (typeof definition.validator !== 'function') {
        return { valid: true, value };
    }
    const result = await definition.validator(value);
    if (result === false) {
        return { valid: false, value: null };
    }
    if (result === true || result === undefined) {
        return { valid: true, value };
    }
    if (result && typeof result === 'object') {
        return {
            valid: Boolean(result.valid),
            value: Object.prototype.hasOwnProperty.call(result, 'value') ? result.value : value,
        };
    }
    return { valid: true, value: result };
}

const createPresenter = (definition) => {
    if (typeof definition.presenter === 'function') {
        return definition.presenter;
    }
    return (value) => {
        if (value === undefined) {
            return 'not provided';
        }
        if (value === null) {
            return 'null value';
        }
        if (typeof value === 'object') {
            try {
                return JSON.stringify(value);
            } catch (error) {
                return String(value);
            }
        }
        return String(value);
    };
};

function canonicalArgumentDefinitions(skill) {
    const metadata = skill.argumentMetadata || {};
    const order = Array.isArray(skill.argumentOrder) && skill.argumentOrder.length
        ? skill.argumentOrder
        : Object.keys(metadata);

    const output = [];
    for (const key of order) {
        const entry = metadata[key];
        if (!entry || typeof entry.name !== 'string') {
            continue;
        }
        output.push(entry);
    }
    return output;
}

async function loadOptionMaps(definitions) {
    const optionEntries = new Map();
    const optionSearches = new Map();
    const optionTotalCounts = new Map();

    for (const def of definitions) {
        if (typeof def.enumerator !== 'function') {
            continue;
        }
        try {
            const raw = await Promise.resolve(def.enumerator());
            const list = Array.isArray(raw) ? raw : (Array.isArray(raw?.options) ? raw.options : []);
            const entries = normalizeOptionEntries(list);
            if (entries.length) {
                optionEntries.set(def.name, entries);
                optionSearches.set(def.name, createOptionSearch(entries));
                const total = Number.isInteger(raw?.totalCount) ? raw.totalCount : entries.length;
                optionTotalCounts.set(def.name, total);
            }
        } catch (error) {
            console.warn(`Failed to load options for argument "${def.name}": ${error.message}`);
        }
    }

    return { optionEntries, optionSearches, optionTotalCounts };
}

function buildArgumentMaps(definitions) {
    const validatorMap = new Map();
    const resolverMap = new Map();
    const presenterMap = new Map();

    for (const def of definitions) {
        if (typeof def.validator === 'function') {
            validatorMap.set(def.name, def.validator);
        }
        if (typeof def.resolver === 'function') {
            resolverMap.set(def.name, def.resolver);
        }
        presenterMap.set(def.name, createPresenter(def));
    }

    return { validatorMap, resolverMap, presenterMap };
}

const normalizeName = (name) => (typeof name === 'string' ? name.trim() : '');

function friendlyName(name) {
    const trimmed = normalizeName(name);
    return trimmed.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

async function createExecutionContext({ skill, action, providedArgs = {}, llmAgent, securityContext = null }) {
    if (!skill || typeof skill !== 'object') {
        throw new Error('createExecutionContext requires a skill definition.');
    }
    if (typeof action !== 'function') {
        throw new Error('createExecutionContext requires an executable action.');
    }

    const definitions = canonicalArgumentDefinitions(skill);
    const requiredArgs = Array.isArray(skill.requiredArguments)
        ? skill.requiredArguments.filter(Boolean)
        : [];
    const requiredSet = new Set(requiredArgs);
    const optionalArgs = definitions
        .map(def => def.name)
        .filter(name => !requiredSet.has(name));

    const { optionEntries, optionSearches, optionTotalCounts } = await loadOptionMaps(definitions);
    const { validatorMap, resolverMap, presenterMap } = buildArgumentMaps(definitions);

    const normalizedArgs = {};
    const invalidArgs = new Set();

    const definitionMap = new Map(definitions.map(def => [def.name, def]));

    const context = {
        skill,
        action,
        llmAgent,
        argumentDefinitions: definitions,
        requiredArguments: requiredArgs,
        optionalArguments: optionalArgs,
        normalizedArgs,
        invalidArgs,
        definitionMap,
        optionEntries,
        optionSearches,
        optionTotalCounts,
        validatorMap,
        resolverMap,
        presenterMap,
        providedArgs: { ...providedArgs },
        securityContext,
    };

    context.hasValue = (name) => {
        if (!Object.prototype.hasOwnProperty.call(normalizedArgs, name)) {
            return false;
        }
        const value = normalizedArgs[name];

        // Check for null/undefined
        if (value === undefined || value === null) {
            return false;
        }

        // Check for placeholder strings that LLMs might generate
        if (typeof value === 'string') {
            const trimmed = value.trim();
            // Empty strings are not valid values
            if (trimmed === '') {
                return false;
            }

            // Check against common placeholder patterns
            const normalized = trimmed.toLowerCase().replace(/[_\s-]/g, '');
            const placeholderKeywords = [
                'notprovided',
                'notset',
                'missing',
                'unknown',
                'none',
                'null',
                'undefined',
                'placeholder',
                'yourtexthere',
                'yourvaluehere',
                'your' + name.replace(/_/g, ''), // e.g., "yourjobname" for job_name
            ];

            // Check for exact matches or contains
            if (placeholderKeywords.some(keyword => normalized === keyword || normalized.includes(keyword))) {
                return false;
            }
            
            // Check for generic 'your*' patterns that might not match the field name
            // This catches patterns like 'your_job_name', 'yourjobname', etc.
            if (normalized.startsWith('your') && normalized.length > 4) {
                return false;
            }
        }

        return true;
    };

    context.getOptionSamples = (name, limit = 10) => {
        const entries = optionEntries.get(name) || [];
        return entries.slice(0, limit).map(entry => entry.label);
    };

    context.getOptionSamplesDetailed = (name, limit = 10) => {
        const entries = optionEntries.get(name) || [];
        const total = optionTotalCounts instanceof Map && optionTotalCounts.has(name)
            ? optionTotalCounts.get(name)
            : entries.length;
        return {
            labels: entries.slice(0, limit).map(entry => entry.label),
            totalCount: total,
        };
    };

    context.presentValue = (name, value) => {
        const presenter = presenterMap.get(name);
        if (presenter) {
            try {
                return presenter(value, { argument: name, context });
            } catch (error) {
                console.warn(`Presenter for argument "${name}" failed: ${error.message}`);
            }
        }
        if (value === undefined) {
            return 'not provided';
        }
        if (value === null) {
            return 'null value';
        }
        if (typeof value === 'object') {
            try {
                return JSON.stringify(value);
            } catch (error) {
                return String(value);
            }
        }
        return String(value);
    };

    context.presentValueAsync = async (name, value) => {
        const presenter = presenterMap.get(name);
        if (presenter) {
            try {
                const result = presenter(value, { argument: name, context });
                const rendered = result && typeof result.then === 'function' ? await result : result;
                if (rendered === undefined) {
                    return 'not provided';
                }
                if (rendered === null) {
                    return 'null value';
                }
                if (typeof rendered === 'object') {
                    try {
                        return JSON.stringify(rendered);
                    } catch (error) {
                        return String(rendered);
                    }
                }
                return String(rendered);
            } catch (error) {
                console.warn(`Async presenter for argument "${name}" failed: ${error.message}`);
            }
        }
        if (value === undefined) {
            return 'not provided';
        }
        if (value === null) {
            return 'null value';
        }
        if (typeof value === 'object') {
            try {
                return JSON.stringify(value);
            } catch (error) {
                return String(value);
            }
        }
        return String(value);
    };

    context.describeArgument = (name) => {
        const definition = definitionMap.get(name);
        if (!definition) {
            return friendlyName(name);
        }
        const description = definition.description || definition.llmHint || '';
        return description
            ? `${friendlyName(name)} — ${description}`
            : friendlyName(name);
    };

    context.resolveRawValue = async (name, rawValue) => {
        const definition = definitionMap.get(name);
        if (!definition) {
            return { success: false, value: null };
        }

        let candidate = rawValue;

        if (resolverMap.has(name)) {
            try {
                candidate = await Promise.resolve(resolverMap.get(name)(rawValue, { argument: name, context }));
            } catch (error) {
                console.warn(`Resolver for argument "${name}" failed: ${error.message}`);
                return { success: false, value: null };
            }
        } else if (optionEntries.has(name)) {
            const match = await resolveOption(definition, rawValue, optionEntries, optionSearches);
            if (match.matched) {
                candidate = match.value;
            }
        }

        candidate = coerceByType(candidate, definition.type);
        const validation = await validateValue({ ...definition, validator: validatorMap.get(name) }, candidate);
        if (!validation.valid) {
            return { success: false, value: null };
        }

        return { success: true, value: validation.value };
    };

    context.setValue = async (name, rawValue) => {
        if (!definitionMap.has(name)) {
            return 'invalid';
        }
        const result = await context.resolveRawValue(name, rawValue);
        if (!result.success) {
            invalidArgs.add(name);
            return 'invalid';
        }
        normalizedArgs[name] = result.value;
        invalidArgs.delete(name);
        return 'applied';
    };

    context.applyUpdates = async (updates = {}) => {
        let applied = false;
        for (const [key, value] of Object.entries(updates)) {
            const resolvedName = definitionMap.has(key) ? key : normalizeName(key);
            const target = definitionMap.has(resolvedName) ? resolvedName : key;
            const outcome = await context.setValue(target, value);
            if (outcome === 'applied') {
                applied = true;
            }
        }
        return applied ? 'updated' : 'unchanged';
    };

    context.missingRequired = () => requiredArgs.filter(name => !context.hasValue(name));
    context.missingOptional = () => optionalArgs.filter(name => !context.hasValue(name));

    context.validationState = () => ({
        missingRequired: context.missingRequired(),
        missingOptional: context.missingOptional(),
        invalid: Array.from(invalidArgs),
        valid: context.missingRequired().length === 0 && invalidArgs.size === 0,
    });

    context.isCancellationIntent = (text) => {
        if (!text || typeof text !== 'string') {
            return false;
        }
        const token = toComparable(text);
        if (Array.from(CANCEL_KEYWORDS).some(keyword => token.startsWith(keyword))) {
            return true;
        }
        if (context.llmAgent && typeof context.llmAgent.classifyMessage === 'function') {
            const { intent } = context.llmAgent.classifyMessage(text, { intents: ['cancel'] });
            return intent === 'cancel';
        }
        return false;
    };

    context.toJSON = () => ({ ...normalizedArgs });

    // Seed initial arguments
    for (const [name, value] of Object.entries(providedArgs || {})) {
        if (!definitionMap.has(name)) {
            continue;
        }
        await context.setValue(name, value);
    }

    return context;
}

export {
    createExecutionContext,
    friendlyName,
};
