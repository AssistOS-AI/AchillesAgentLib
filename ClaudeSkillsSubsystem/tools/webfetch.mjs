import { parseJsonInput } from './utils.mjs';

function decodeHtmlEntities(text) {
    return text
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
}

function htmlToText(html) {
    let cleaned = html;
    cleaned = cleaned.replace(/<script[\s\S]*?<\/script>/gi, '');
    cleaned = cleaned.replace(/<style[\s\S]*?<\/style>/gi, '');
    cleaned = cleaned.replace(/<br\s*\/?>/gi, '\n');
    cleaned = cleaned.replace(/<\/(p|div|section|article|h\d|li|ul|ol)>/gi, '\n');
    cleaned = cleaned.replace(/<[^>]+>/g, '');
    cleaned = decodeHtmlEntities(cleaned);
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
    return cleaned.trim();
}

export function buildWebFetchTool() {
    return {
        description: `Fetch web content from a URL.
When to use: open or inspect a webpage.
How to call: pass JSON string with url and prompt (prompt is required, but currently ignored).
Examples:
- {"url":"https://example.com","prompt":"summarize"}
- {"url":"https://example.com/docs","prompt":"extract headings"}
Notes: returns plain text; HTML is stripped to text.`,
        handler: async (_agent, promptText) => {
            const { json } = parseJsonInput(promptText);
            if (!json || typeof json !== 'object') {
                throw new Error('WebFetch requires JSON input with url and prompt.');
            }
            const url = String(json.url || '').trim();
            if (!url) {
                throw new Error('WebFetch requires a url.');
            }
            const prompt = String(json.prompt || '').trim();
            if (!prompt) {
                throw new Error('WebFetch requires a prompt.');
            }
            if (typeof fetch !== 'function') {
                throw new Error('WebFetch is not available in this runtime.');
            }
            const response = await fetch(url, { redirect: 'follow' });
            const contentType = response.headers.get('content-type') || '';
            const body = await response.text();
            if (contentType.includes('text/html')) {
                return htmlToText(body);
            }
            return body.trim();
        },
    };
}
