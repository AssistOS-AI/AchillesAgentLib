import { ensureLeadingSlash } from './utils.mjs';

// normalizeLinks should lowercase links and ensure a leading slash for relative links.
export function normalizeLinks(links) {
    return links.map(link => {
        if (link.toLowerCase().startsWith('http')) {
            return link;
        }
        return ensureLeadingSlash(link);
    });
}