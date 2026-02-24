import { extractHref } from './selector.mjs';

export function parseLinks(html) {
    const matches = html.match(/<a\s+[^>]*href=["'][^"']+["'][^>]*>/g) || [];
    return matches.map(tag => extractHref(tag)).filter(Boolean);
}
