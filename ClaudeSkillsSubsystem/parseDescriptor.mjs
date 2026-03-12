import fs from 'node:fs';
import path from 'node:path';

import { createSectionKey } from '../utils/skillDocumentParser.mjs';

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

export function parseClaudeSkillDocument(filePath) {
    let raw = '';
    try {
        raw = fs.readFileSync(filePath, 'utf8');
    } catch (error) {
        return {
            name: path.basename(path.dirname(filePath)),
            rawContent: '',
            sections: {},
        };
    }

    const stripped = stripFrontmatter(raw);
    const frontmatter = stripped.frontmatter || {};
    const content = stripped.body || '';

    const lines = content.split(/\r?\n/);
    let name = frontmatter.name || null;
    const sections = new Map();
    const sectionBuffers = new Map();
    let currentSection = null;

    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.match(/^#\s/)) {
            const headingText = trimmed.replace(/^#+\s*/, '').trim();
            if (!name) {
                name = headingText;
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

        if (currentSection) {
            const buffer = sectionBuffers.get(currentSection) || [];
            buffer.push(line);
            sectionBuffers.set(currentSection, buffer);
        }
    }

    if (!name) {
        name = path.basename(path.dirname(filePath));
    }

    sectionBuffers.forEach((buffer, key) => {
        const joined = buffer.join('\n').trim();
        if (joined) {
            sections.set(key, joined);
        }
    });

    return {
        name,
        rawContent: content,
        sections: Object.fromEntries(sections),
    };
}
