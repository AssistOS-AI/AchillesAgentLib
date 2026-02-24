import { fetchHtml } from './fetcher.mjs';
import { parseLinks } from './parser.mjs';
import { normalizeLinks } from './normalizer.mjs';
import { filterUnique } from './links.mjs';

export async function scrapeLinks(source) {
    const html = await fetchHtml(source);
    const rawLinks = parseLinks(html);
    const normalized = normalizeLinks(rawLinks);
    return filterUnique(normalized);
}
