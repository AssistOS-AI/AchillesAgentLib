function normalizeHeading(value = '') {
    return String(value || '')
        .trim()
        .replace(/[`*_]+/g, '');
}

function collectMarkdownSections(markdown) {
    if (typeof markdown !== 'string') {
        return null;
    }

    const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
    const sections = [];
    let current = null;
    let currentLines = [];

    const flush = () => {
        if (current) {
            sections.push({
                title: current,
                content: currentLines.join('\n').trim(),
            });
        }
        currentLines = [];
    };

    for (const line of lines) {
        const headingMatch = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
        if (headingMatch) {
            flush();
            current = normalizeHeading(headingMatch[1]);
            continue;
        }
        if (current) {
            currentLines.push(line);
        }
    }
    flush();

    return sections;
}

function parseKeyValueMarkdown(markdown) {
    const sections = collectMarkdownSections(markdown);
    if (!sections) {
        return null;
    }
    const result = {};
    for (const section of sections) {
        if (section.title && section.content) {
            result[section.title] = section.content;
        }
    }
    return result;
}

function parseConfirmationMarkdown(markdown) {
    const sections = parseKeyValueMarkdown(markdown);
    if (!sections) {
        return null;
    }

    const decision = String(sections.decision || '').trim().toLowerCase();
    if (!['yes', 'no', 'unclear'].includes(decision)) {
        return null;
    }

    const parsedConfidence = Number(String(sections.confidence || '').trim());
    const confidence = Number.isFinite(parsedConfidence)
        ? Math.max(0, Math.min(1, parsedConfidence))
        : 0.7;

    return { decision, confidence };
}

function parseDetectIntentsMarkdown(markdown) {
    const parsed = parseKeyValueMarkdown(markdown);
    if (!parsed || !Object.keys(parsed).length) {
        return null;
    }
    return parsed;
}

export {
    collectMarkdownSections,
    parseConfirmationMarkdown,
    parseDetectIntentsMarkdown,
};
