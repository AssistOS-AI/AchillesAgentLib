const TOOL_IMPLEMENTATIONS = {
    add: async (a, b) => String(Number(a) + Number(b)),
    multiply: async (a, b) => String(Number(a) * Number(b)),
    subtract: async (a, b) => String(Number(a) - Number(b)),
    divide: async (a, b) => {
        const divisor = Number(b);
        if (divisor === 0) {
            return 'Infinity';
        }
        return String(Number(a) / divisor);
    },
    reverse: async (text) => String(text).split('').reverse().join(''),
    uppercase: async (text) => String(text).toUpperCase(),
    lowercase: async (text) => String(text).toLowerCase(),
    length: async (text) => String(String(text).length),
    concat: async (a, b) => `${String(a)}${String(b)}`,
    substring: async (text, start, len) => {
        const begin = Number(start);
        const take = Number(len);
        return String(text).substring(begin, begin + take);
    },
    contains: async (haystack, needle) => (String(haystack).includes(String(needle)) ? 'true' : 'false'),
    isEven: async (value) => (Number(value) % 2 === 0 ? 'true' : 'false'),
    invert: async (value) => (String(value).trim() === 'true' ? 'false' : 'true'),
    and: async (a, b) => (String(a).trim() === 'true' && String(b).trim() === 'true' ? 'true' : 'false'),
    or: async (a, b) => (String(a).trim() === 'true' || String(b).trim() === 'true' ? 'true' : 'false'),
    extractEmail: async (text) => {
        const match = String(text).match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
        return match ? match[0] : '';
    },
    getDomain: async (email) => {
        const parts = String(email).split('@');
        return parts.length > 1 ? parts[1] : '';
    },
};

function createCommandsRegistry(tools = {}) {
    const allowed = Object.keys(tools || {});
    const whitelist = allowed.length
        ? allowed.filter((name) => Object.prototype.hasOwnProperty.call(TOOL_IMPLEMENTATIONS, name))
        : Object.keys(TOOL_IMPLEMENTATIONS);
    const allowedSet = new Set(whitelist);

    return {
        async executeCommand(payload, response) {
            const { command, args } = payload;
            if (!allowedSet.has(command)) {
                return response.fail(`Unknown command: ${command}`);
            }
            const handler = TOOL_IMPLEMENTATIONS[command];
            try {
                const value = await handler(...(args ?? []));
                return response.success(value);
            } catch (error) {
                return response.fail(error.message || String(error));
            }
        },
        listCommands: () => whitelist.map((name) => ({
            name,
            description: tools?.[name] || '',
        })),
    };
}

export {
    createCommandsRegistry,
};
