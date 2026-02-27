import { ensureLeadingSlash } from './utils.mjs';

export function normalizeLinks(links) {
    return links.map(link => {
        if (link.startsWith('http')) {
            return link.toLowerCase();
        }
        return ensureLeadingSlash(link.toLowerCase());
    });
}
