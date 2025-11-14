let registeredClient = null;

const toPascalCase = (value = '') => value
    .split(/[^a-z0-9]+/i)
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join('');

function ensureClient() {
    if (!registeredClient) {
        throw new Error('No Persisto client has been registered. Call registerPersistoClient first.');
    }
    return registeredClient;
}

function ensureFunction(client, methodName) {
    const fn = client?.[methodName];
    if (typeof fn !== 'function') {
        throw new Error(`Persisto client is missing method "${methodName}".`);
    }
    return fn;
}

export function registerPersistoClient(client) {
    if (!client || typeof client !== 'object') {
        throw new TypeError('registerPersistoClient requires a client object.');
    }
    registeredClient = client;
}

export function getPersistoClient() {
    return registeredClient;
}

export function buildTableClient(tableName) {
    if (!tableName) {
        throw new Error('buildTableClient requires a table name.');
    }
    const client = ensureClient();
    const pascalName = toPascalCase(tableName);
    const getters = {
        get: ensureFunction(client, `get${pascalName}`).bind(client),
        update: ensureFunction(client, `update${pascalName}`).bind(client),
        create: ensureFunction(client, `create${pascalName}`).bind(client),
        select: typeof client.select === 'function'
            ? client.select.bind(client, tableName)
            : null,
    };

    return {
        async get(identifier) {
            return getters.get(identifier);
        },
        async update(record) {
            return getters.update(record);
        },
        async create(record) {
            return getters.create(record);
        },
        async select(filters = {}, options = {}) {
            if (!getters.select) {
                throw new Error('Persisto client does not expose a generic select method.');
            }
            return getters.select(filters, options);
        },
    };
}

export function buildGroupingAccessor(groupName, fieldName) {
    const client = ensureClient();
    if (!groupName || !fieldName) {
        throw new Error('buildGroupingAccessor requires both a group name and a field name.');
    }
    const methodName = `get${toPascalCase(groupName)}ObjectsBy${toPascalCase(fieldName)}`;
    const fn = ensureFunction(client, methodName).bind(client);
    return (value) => fn(value);
}

export function buildRelationAccessor(tableOne, tableTwo) {
    const client = ensureClient();
    if (!tableOne || !tableTwo) {
        throw new Error('buildRelationAccessor requires two table names.');
    }
    const methodName = `get${toPascalCase(tableOne)}FromRelWith${toPascalCase(tableTwo)}`;
    const fn = ensureFunction(client, methodName).bind(client);
    return (id) => fn(id);
}

export default {
    registerPersistoClient,
    getPersistoClient,
    buildTableClient,
    buildGroupingAccessor,
    buildRelationAccessor,
};
