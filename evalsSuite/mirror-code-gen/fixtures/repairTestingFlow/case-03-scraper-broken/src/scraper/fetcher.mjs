const sources = new Map();

export function registerSource(key, html) {
    sources.set(key, html);
}

export async function fetchHtml(key) {
    if (!sources.has(key)) {
        throw new Error('Source not found');
    }
    return sources.get(key);
}
