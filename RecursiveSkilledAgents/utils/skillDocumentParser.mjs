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

    const lines = raw.split(/\r?\n/);
    let title = null;
    let summary = null;
    const bodyLines = [];
    const sections = new Map();
    const sectionBuffers = new Map();
    let currentSection = null;

    for (const line of lines) {
        const trimmed = line.trim();
        if (!title && trimmed.startsWith('#')) {
            const headingText = trimmed.replace(/^#+\s*/, '').trim();
            title = headingText;
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
