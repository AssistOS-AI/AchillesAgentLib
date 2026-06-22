const SECTION_ALIASES = {
    tool: 'tool',
    prompt: 'prompt',
    reason: 'reason',
};

function normalizeSectionName(value = '') {
    const normalized = String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[`*_]+/g, '')
        .replace(/\s+/g, '_');
    return SECTION_ALIASES[normalized] || null;
}

function parsePlannerDecisionMarkdown(markdown) {
    if (typeof markdown !== 'string') {
        return null;
    }

    const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
    const sections = {};
    let currentKey = null;
    let currentLines = [];

    const flush = () => {
        if (!currentKey) {
            currentLines = [];
            return;
        }
        sections[currentKey] = currentLines.join('\n').trim();
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

    const tool = typeof sections.tool === 'string' ? sections.tool.trim() : '';
    const prompt = typeof sections.prompt === 'string' ? sections.prompt.trim() : '';
    const reason = typeof sections.reason === 'string' ? sections.reason.trim() : '';

    if (!tool || !prompt) {
        return null;
    }

    return {
        tool,
        prompt,
        reason,
    };
}

export {
    parsePlannerDecisionMarkdown,
};
