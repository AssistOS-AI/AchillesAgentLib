export function normalizeCommandDocs(entries) {
    if (!Array.isArray(entries)) {
        return [];
    }
    return entries.map((entry) => {
        if (!entry || typeof entry !== 'object') {
            return { name: String(entry ?? ''), description: '' };
        }
        const name = entry.name ?? entry.command ?? '';
        return {
            name: String(name),
            description: typeof entry.description === 'string' ? entry.description : '',
        };
    });
}

export function createRegistry(executeCommand, docs = []) {
    const docSource = typeof docs === 'function' ? docs : () => normalizeCommandDocs(docs);
    return {
        async executeCommand(payload, response) {
            return executeCommand(payload, response);
        },
        listCommands: () => normalizeCommandDocs(docSource()),
    };
}
