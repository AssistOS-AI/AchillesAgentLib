const SECTION_ALIASES = {
    tool: 'tool',
    toolname: 'tool',
    prompt: 'prompt',
    promptname: 'prompt',
    reason: 'reason',
    finalanswer: 'finalAnswer',
};

function normalizeSectionName(value = '') {
    const normalized = String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[`*_]+/g, '')
        .replace(/[\s_-]+/g, '');
    return SECTION_ALIASES[normalized] || null;
}

function stripOuterDecisionFence(markdown) {
    const trimmed = markdown.trim();
    const match = trimmed.match(/^(`{3,}|~{3,})(?:markdown|md|text)?[ \t]*\n([\s\S]*?)\n\1[ \t]*$/i);
    return match ? match[2] : trimmed;
}

function normalizeJsonSectionValue(key, value) {
    if (typeof value === 'string') {
        return value.trim();
    }
    if (value === null || value === undefined) {
        return '';
    }
    if (key === 'tool') {
        return typeof value === 'number' || typeof value === 'boolean'
            ? String(value)
            : '';
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
    }
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

function buildDecisionFromSections(sections) {
    const has = (key) => Object.prototype.hasOwnProperty.call(sections, key);
    const reason = has('reason') ? sections.reason : '';

    if (has('finalAnswer')) {
        return {
            tool: 'final_answer',
            prompt: sections.finalAnswer,
            reason,
        };
    }

    if (has('tool') && sections.tool) {
        return {
            tool: sections.tool,
            prompt: has('prompt') ? sections.prompt : '',
            reason,
        };
    }

    if (has('prompt')) {
        return {
            tool: 'final_answer',
            prompt: sections.prompt,
            reason,
        };
    }

    if (has('reason')) {
        return {
            tool: 'final_answer',
            prompt: sections.reason,
            reason,
        };
    }

    return null;
}

function parseJsonDecision(markdown) {
    const trimmed = markdown.trim();
    const fenceMatch = trimmed.match(/^(`{3,}|~{3,})(json)?[ \t]*\n([\s\S]*?)\n\1[ \t]*$/i);
    const explicitlyJson = Boolean(fenceMatch?.[2]);
    const candidate = fenceMatch ? fenceMatch[3].trim() : trimmed;

    let parsed;
    try {
        parsed = JSON.parse(candidate);
    } catch {
        return { matched: explicitlyJson, decision: null };
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { matched: true, decision: null };
    }

    const sections = {};
    for (const [rawKey, value] of Object.entries(parsed)) {
        const key = normalizeSectionName(rawKey);
        if (key) {
            sections[key] = normalizeJsonSectionValue(key, value);
        }
    }

    return {
        matched: true,
        decision: buildDecisionFromSections(sections),
    };
}

function splitLabelAndValue(value = '') {
    const separatorIndex = value.indexOf(':');
    if (separatorIndex < 0) {
        return { key: normalizeSectionName(value), inlineValue: null };
    }
    return {
        key: normalizeSectionName(value.slice(0, separatorIndex)),
        inlineValue: value.slice(separatorIndex + 1).trim(),
    };
}

function parseSectionStart(line) {
    const headingMatch = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
    if (headingMatch) {
        return splitLabelAndValue(headingMatch[1]);
    }

    const boldColonInsideMatch = line.match(/^\s*(?:\*\*|__)\s*(.+?)\s*:\s*(?:\*\*|__)\s*(.*)$/);
    if (boldColonInsideMatch) {
        return {
            key: normalizeSectionName(boldColonInsideMatch[1]),
            inlineValue: boldColonInsideMatch[2].trim(),
        };
    }

    const boldLabelMatch = line.match(/^\s*(?:\*\*|__)\s*(.+?)\s*(?:\*\*|__)\s*:\s*(.*)$/);
    if (boldLabelMatch) {
        return {
            key: normalizeSectionName(boldLabelMatch[1]),
            inlineValue: boldLabelMatch[2].trim(),
        };
    }

    const plainLabelMatch = line.match(/^\s*([A-Za-z][A-Za-z0-9 _-]*?)\s*:\s*(.*)$/);
    if (plainLabelMatch) {
        return {
            key: normalizeSectionName(plainLabelMatch[1]),
            inlineValue: plainLabelMatch[2].trim(),
        };
    }

    return null;
}

function updateFenceState(line, activeFence) {
    const fenceMatch = line.match(/^\s{0,3}(`{3,}|~{3,})(.*)$/);
    if (!fenceMatch) {
        return activeFence;
    }
    const marker = fenceMatch[1];
    if (!activeFence) {
        return { character: marker[0], length: marker.length };
    }
    if (marker[0] === activeFence.character && marker.length >= activeFence.length) {
        return null;
    }
    return activeFence;
}

function parsePlannerDecisionMarkdown(markdown) {
    if (typeof markdown !== 'string') {
        return null;
    }

    const original = markdown.replace(/\r\n?/g, '\n').trim();
    if (!original) {
        return null;
    }

    const originalJson = parseJsonDecision(original);
    if (originalJson.matched) {
        return originalJson.decision;
    }

    const response = stripOuterDecisionFence(original);
    if (!response) {
        return null;
    }

    if (response !== original) {
        const fencedJson = parseJsonDecision(response);
        if (fencedJson.matched) {
            return fencedJson.decision;
        }
    }

    const lines = response.split('\n');
    const sections = {};
    let currentKey = null;
    let currentLines = [];
    let activeFence = null;
    let recognizedSections = 0;

    const flush = () => {
        if (currentKey) {
            sections[currentKey] = currentLines.join('\n').trim();
        }
        currentLines = [];
    };

    for (const line of lines) {
        if (activeFence) {
            if (currentKey) {
                currentLines.push(line);
            }
            activeFence = updateFenceState(line, activeFence);
            continue;
        }

        const nextFence = updateFenceState(line, null);
        if (nextFence) {
            if (currentKey) {
                currentLines.push(line);
            }
            activeFence = nextFence;
            continue;
        }

        const sectionStart = parseSectionStart(line);
        if (sectionStart?.key) {
            flush();
            currentKey = sectionStart.key;
            currentLines = sectionStart.inlineValue === null ? [] : [sectionStart.inlineValue];
            recognizedSections += 1;
            continue;
        }

        if (currentKey) {
            currentLines.push(line);
        }
    }
    flush();

    if (recognizedSections > 0) {
        return buildDecisionFromSections(sections);
    }

    return {
        tool: 'final_answer',
        prompt: response,
        reason: '',
    };
}

export {
    parsePlannerDecisionMarkdown,
};
