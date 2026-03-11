import fs from 'node:fs';
import path from 'node:path';

/**
 * Convert a heading text to a normalized section key.
 * Trims whitespace, lowercases, replaces non-alphanumeric with hyphens,
 * and removes leading/trailing hyphens.
 *
 * @param {string} heading - The heading text to convert
 * @returns {string} Normalized key suitable for section lookup
 */
export function createSectionKey(heading) {
    return heading
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function stripFrontmatter(raw) {
    if (!raw) {
        return { frontmatter: {}, body: '' };
    }

    const lines = raw.split(/\r?\n/);
    let index = 0;
    while (index < lines.length && !lines[index].trim()) {
        index += 1;
    }

    if (lines[index]?.trim() !== '---') {
        return { frontmatter: {}, body: raw };
    }

    let endIndex = -1;
    for (let i = index + 1; i < lines.length; i += 1) {
        if (lines[i].trim() === '---') {
            endIndex = i;
            break;
        }
    }

    if (endIndex === -1) {
        return { frontmatter: {}, body: raw };
    }

    const frontmatterLines = lines.slice(index + 1, endIndex);
    const bodyLines = lines.slice(endIndex + 1);
    const frontmatter = {};

    for (const line of frontmatterLines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) {
            continue;
        }
        const separator = trimmed.indexOf(':');
        if (separator === -1) {
            continue;
        }
        const key = trimmed.slice(0, separator).trim();
        let value = trimmed.slice(separator + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        if (key) {
            frontmatter[key] = value;
        }
    }

    return { frontmatter, body: bodyLines.join('\n') };
}

/**
 * Parse a skill markdown document into a structured descriptor.
 * Extracts title (first heading), summary (first non-empty line after title),
 * body (all non-empty lines), and sections (keyed by normalized heading).
 *
 * @param {string} filePath - Path to the skill markdown file
 * @returns {{title: string, summary: string, body: string, sections: Object}} Parsed skill descriptor
 */
export function parseSkillDocument(filePath) {
    let raw = '';
    try {
        raw = fs.readFileSync(filePath, 'utf8');
    } catch (error) {
        return {
            title: path.basename(path.dirname(filePath)),
            summary: `Unable to read ${path.basename(filePath)}: ${error.message}`,
            body: '',
            sections: {},
        };
    }

    const isAnthropicSkill = path.basename(filePath) === 'SKILL.md';
    let frontmatter = {};
    let content = raw;
    if (isAnthropicSkill) {
        const stripped = stripFrontmatter(raw);
        frontmatter = stripped.frontmatter || {};
        content = stripped.body || '';
    }

    const lines = content.split(/\r?\n/);
    let title = isAnthropicSkill && frontmatter.name ? frontmatter.name : null;
    let summary = isAnthropicSkill && frontmatter.description ? frontmatter.description : null;
    const bodyLines = [];
    const sections = new Map();
    const sectionBuffers = new Map();
    let currentSection = null;

    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.match(/^#\s/)) {
            const headingText = trimmed.replace(/^#+\s*/, '').trim();
            if (!title) {
                title = headingText;
            }
            currentSection = createSectionKey(headingText);
            if (!sectionBuffers.has(currentSection)) {
                sectionBuffers.set(currentSection, []);
            }
            continue;
        }

        const headingMatch = trimmed.match(/^#{2,}\s*(.+)$/);
        if (headingMatch) {
            const headingText = headingMatch[1].trim();
            currentSection = createSectionKey(headingText);
            if (!sectionBuffers.has(currentSection)) {
                sectionBuffers.set(currentSection, []);
            }
            continue;
        }

        if (!summary && trimmed) {
            summary = trimmed;
        }

        if (currentSection) {
            const buffer = sectionBuffers.get(currentSection) || [];
            buffer.push(line);
            sectionBuffers.set(currentSection, buffer);
        }

        if (trimmed) {
            bodyLines.push(trimmed);
        }
    }

    if (!title) {
        title = path.basename(path.dirname(filePath));
    }

    if (!summary) {
        summary = `Auto-registered skill described in ${path.basename(filePath)}.`;
    }

    sectionBuffers.forEach((buffer, key) => {
        const joined = buffer.join('\n').trim();
        if (joined) {
            sections.set(key, joined);
        }
    });

    return {
        title,
        summary,
        body: bodyLines.join('\n'),
        sections: Object.fromEntries(sections),
    };
}
