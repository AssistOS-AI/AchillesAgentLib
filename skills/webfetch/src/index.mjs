import { parseKeyValueInput, stripDependsOn } from '../../../utils/internalSkillsUtils.mjs';

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

export async function action(context) {
    const { promptText, llmAgent } = context;
    const sanitizedPrompt = stripDependsOn(promptText);
    const { data } = parseKeyValueInput(sanitizedPrompt);
    if (!data || typeof data !== 'object' || !Object.keys(data).length) {
        throw new Error('WebFetch requires input with url and prompt.');
    }
    const url = String(data.url || '').trim();
    if (!url) {
        throw new Error('WebFetch requires a url.');
    }
    const prompt = String(data.prompt || '').trim();
    if (!prompt) {
        throw new Error('WebFetch requires a prompt.');
    }
    if (typeof fetch !== 'function') {
        throw new Error('WebFetch is not available in this runtime.');
    }
    const response = await fetch(url, { redirect: 'follow' });
    const contentType = response.headers.get('content-type') || '';
    const body = await response.text();
    const pageText = contentType.includes('text/html')
        ? htmlToText(body)
        : body.trim();
    const promptForLlm = [
        'You are extracting information from a web page.',
        `User request: ${prompt}`,
        'Page content:',
        pageText,
    ].join('\n\n');
    const llmResult = await llmAgent.executePrompt(promptForLlm, {
        responseShape: 'text',
        tier: context?.tierConfig?.execution || 'fast',
        context,
    });
    return (llmResult && typeof llmResult === 'string')
        ? llmResult
        : (llmResult?.output || llmResult?.result || llmResult?.text || '').toString().trim();
}
