const SECTION_ALIASES = {
    summary: 'summary',
    keepresultrefs: 'keepResultRefs',
    keep_result_refs: 'keepResultRefs',
    'keep-result-refs': 'keepResultRefs',
};

function normalizeSectionName(value = '') {
    const normalized = String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[`*_]+/g, '')
        .replace(/\s+/g, '_');
    return SECTION_ALIASES[normalized] || null;
}

function collectMarkdownSections(markdown) {
    const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
    const sections = {};
    let currentKey = null;
    let currentLines = [];

    const flush = () => {
        if (currentKey) {
            sections[currentKey] = currentLines.join('\n').trim();
        }
        currentLines = [];
    };

    for (const line of lines) {
        const headingMatch = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
        if (headingMatch) {
            const key = normalizeSectionName(headingMatch[1]);
            if (key) {
                flush();
                currentKey = key;
                continue;
            }
        }

        if (currentKey) {
            currentLines.push(line);
        }
    }
    flush();

    return sections;
}

function parseKeepResultRefs(text = '') {
    return String(text || '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => line.replace(/^\s*(?:[-*+]|\d+[.)-])\s+/, '').trim())
        .filter(Boolean);
}

function parseHistoryCompressionMarkdown(markdown) {
    if (typeof markdown !== 'string') {
        return null;
    }

    const sections = collectMarkdownSections(markdown);
    const summary = typeof sections.summary === 'string' ? sections.summary.trim() : '';
    if (!summary) {
        return null;
    }

    return {
        summary,
        keepResultRefs: parseKeepResultRefs(sections.keepResultRefs || ''),
    };
}

export {
    parseHistoryCompressionMarkdown,
};
