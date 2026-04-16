import fs from 'node:fs/promises';
import path from 'node:path';

function normalizePathSegment(value, fieldName) {
    const normalized = typeof value === 'string' ? value.trim() : '';
    if (!normalized) {
        return '';
    }
    if (normalized.includes('/') || normalized.includes('\\')) {
        throw new Error(`${fieldName} must not include path separators.`);
    }
    if (path.basename(normalized) !== normalized) {
        throw new Error(`${fieldName} must be a simple name.`);
    }
    return normalized;
}

function normalizeFileName(fileName) {
    const normalized = normalizePathSegment(fileName, 'fileName');
    if (!normalized) {
        throw new Error('fileName is required.');
    }
    return normalized.endsWith('.md') ? normalized.slice(0, -3) : normalized;
}

function normalizeType(type) {
    if (type === undefined || type === null || String(type).trim() === '') {
        return '';
    }
    return normalizePathSegment(type, 'type');
}

function normalizeSectionContent(value) {
    const normalized = String(value ?? '').trim();
    return normalized || '*None*';
}

function normalizeSectionName(value) {
    return String(value ?? '').trim();
}

function toIndexIfNumeric(value) {
    const text = String(value ?? '').trim();
    if (!/^\d+$/.test(text)) {
        return null;
    }
    const parsed = Number(text);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseSectionHeadings(markdown) {
    const content = String(markdown ?? '');
    const headingPattern = /^###\s+(\d+)\.\s+(.+?)\s*$/gm;
    const matches = [];
    let match;
    while ((match = headingPattern.exec(content)) !== null) {
        matches.push({
            index: Number(match[1]),
            name: match[2].trim(),
            start: match.index,
            end: headingPattern.lastIndex,
        });
    }

    if (matches.length === 0) {
        return [];
    }

    const parsed = [];
    for (let i = 0; i < matches.length; i += 1) {
        const current = matches[i];
        const next = matches[i + 1];
        const sectionBodyStart = current.end + (content[current.end] === '\n' ? 1 : 0);
        const sectionBodyEnd = next ? next.start : content.length;
        const sectionBody = content.slice(sectionBodyStart, sectionBodyEnd).trim();
        parsed.push({
            index: current.index,
            name: current.name,
            content: sectionBody,
        });
    }

    return parsed;
}

function renderSections(sections) {
    if (!Array.isArray(sections) || sections.length === 0) {
        return '';
    }

    return sections
        .map((section, position) => {
            const header = `### ${position + 1}. ${section.name}`;
            const body = normalizeSectionContent(section.content);
            return `${header}\n${body}`;
        })
        .join('\n\n');
}

function normalizeSelectors(sections) {
    if (sections === undefined || sections === null) {
        return [];
    }

    if (Array.isArray(sections)) {
        return sections.map((value) => {
            const byIndex = toIndexIfNumeric(value);
            return byIndex !== null
                ? { kind: 'index', value: byIndex }
                : { kind: 'name', value: normalizeSectionName(value) };
        }).filter((selector) => selector.value);
    }

    if (typeof sections === 'object') {
        return Object.keys(sections).map((key) => {
            const byIndex = toIndexIfNumeric(key);
            return byIndex !== null
                ? { kind: 'index', value: byIndex }
                : { kind: 'name', value: normalizeSectionName(key) };
        }).filter((selector) => selector.value);
    }

    throw new Error('sections must be an object or an array.');
}

function hasSelectors(sections) {
    if (sections === undefined || sections === null) {
        return false;
    }
    if (Array.isArray(sections)) {
        return sections.length > 0;
    }
    if (typeof sections === 'object') {
        return Object.keys(sections).length > 0;
    }
    return false;
}

function toSectionList(sections) {
    return sections.map((section, index) => ({
        index: index + 1,
        name: section.name,
        content: String(section.content ?? '').trim() || '*None*',
    }));
}

function toRawSectionContent(value) {
    const normalized = String(value ?? '').trim();
    return normalized && normalized !== '*None*' ? normalized : '';
}

function findSectionIndex(sections, selector) {
    if (selector.kind === 'index') {
        return sections.findIndex((_section, index) => index + 1 === selector.value);
    }
    const target = selector.value.toLowerCase();
    return sections.findIndex((section) => section.name.toLowerCase() === target);
}

export class MarkdownDataStore {
    constructor({ dataDir } = {}) {
        const normalizedDir = typeof dataDir === 'string' ? dataDir.trim() : '';
        if (!normalizedDir) {
            throw new Error('MarkdownDataStore requires a dataDir.');
        }
        this.dataDir = path.resolve(normalizedDir);
    }

    #resolveFilePath(type, fileName) {
        const normalizedType = normalizeType(type);
        const normalizedFileName = normalizeFileName(fileName);
        const baseDir = normalizedType
            ? path.join(this.dataDir, normalizedType)
            : this.dataDir;
        return {
            type: normalizedType || null,
            fileName: normalizedFileName,
            dirPath: baseDir,
            filePath: path.join(baseDir, `${normalizedFileName}.md`),
        };
    }

    async #readMarkdown(filePath) {
        return fs.readFile(filePath, 'utf8');
    }

    async #readSections(filePath) {
        const rawMarkdown = await this.#readMarkdown(filePath);
        return {
            rawMarkdown,
            sections: parseSectionHeadings(rawMarkdown),
        };
    }

    async #writeSections(filePath, sections) {
        const rendered = renderSections(sections);
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, rendered ? `${rendered}\n` : '', 'utf8');
        return rendered;
    }

    async listFiles(type = null) {
        const normalizedType = normalizeType(type);
        const targetDir = normalizedType
            ? path.join(this.dataDir, normalizedType)
            : this.dataDir;

        let entries;
        try {
            entries = await fs.readdir(targetDir, { withFileTypes: true });
        } catch (error) {
            if (error && error.code === 'ENOENT') {
                return { type: normalizedType || null, files: [] };
            }
            throw error;
        }

        const files = entries
            .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
            .map((entry) => entry.name.slice(0, -3))
            .sort((left, right) => left.localeCompare(right));

        return {
            type: normalizedType || null,
            files,
        };
    }

    async getFile(type = null, fileName, sections = null) {
        const location = this.#resolveFilePath(type, fileName);
        const fileRecord = await this.#readSections(location.filePath);
        const allSections = toSectionList(fileRecord.sections);

        if (!hasSelectors(sections)) {
            return {
                type: location.type,
                fileName: location.fileName,
                sections: allSections,
                rawMarkdown: fileRecord.rawMarkdown,
            };
        }

        const selectors = normalizeSelectors(sections);
        const selected = [];
        const seen = new Set();
        for (const selector of selectors) {
            const sectionIndex = findSectionIndex(allSections, selector);
            if (sectionIndex === -1 || seen.has(sectionIndex)) {
                continue;
            }
            seen.add(sectionIndex);
            selected.push(allSections[sectionIndex]);
        }

        return {
            type: location.type,
            fileName: location.fileName,
            sections: selected,
        };
    }

    parseList(text) {
        const raw = toRawSectionContent(text);
        if (!raw) {
            return [];
        }
        const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
        const values = [];
        const seen = new Set();
        for (const line of lines) {
            const normalized = line.replace(/^- /, '').trim();
            if (!normalized || seen.has(normalized)) {
                continue;
            }
            seen.add(normalized);
            values.push(normalized);
        }
        return values;
    }

    renderList(values) {
        const items = this.parseList(
            Array.isArray(values)
                ? values.map((value) => `- ${String(value ?? '').trim()}`).join('\n')
                : ''
        );
        return items.length > 0 ? items.map((value) => `- ${value}`).join('\n') : '*None*';
    }

    parseDialogue(text) {
        const raw = toRawSectionContent(text);
        if (!raw) {
            return [];
        }
        const lines = raw.split(/\r?\n/);
        const entries = [];
        let current = null;

        const flush = () => {
            if (current) {
                entries.push(current);
                current = null;
            }
        };

        for (const line of lines) {
            const match = line.match(/^- \*\*(.+?)\*\*: ?(.*)$/);
            if (match) {
                flush();
                current = { speaker: match[1], message: match[2] ?? '' };
                continue;
            }
            if (!current) {
                continue;
            }
            if (line.startsWith('  ')) {
                current.message += `\n${line.slice(2)}`;
            } else {
                current.message += `\n${line}`;
            }
        }
        flush();
        return entries;
    }

    renderDialogue(entries) {
        if (!Array.isArray(entries) || entries.length === 0) {
            return '*None*';
        }
        return entries.map((entry) => {
            const speaker = String(entry?.speaker ?? '').trim() || 'Unknown';
            const messageLines = String(entry?.message ?? '').split(/\r?\n/);
            const [first = '', ...rest] = messageLines;
            if (rest.length === 0) {
                return `- **${speaker}**: ${first}`;
            }
            return `- **${speaker}**: ${first}\n${rest.map((line) => `  ${line}`).join('\n')}`;
        }).join('\n');
    }

    parseKeyValue(text) {
        const raw = toRawSectionContent(text);
        if (!raw) {
            return {};
        }
        const result = {};
        for (const line of raw.split(/\r?\n/)) {
            const match = line.match(/^- \*\*(.+?)\*\*: ?(.*)$/);
            if (!match) {
                continue;
            }
            const key = match[1].trim();
            const value = match[2].trim();
            if (key) {
                result[key] = value;
            }
        }
        return result;
    }

    renderKeyValue(record) {
        const entries = Object.entries(record ?? {})
            .map(([key, value]) => [String(key).trim(), String(value ?? '').trim()])
            .filter(([key, value]) => key && value)
            .sort(([a], [b]) => a.localeCompare(b));
        return entries.length > 0
            ? entries.map(([key, value]) => `- **${key}**: ${value}`).join('\n')
            : '*None*';
    }

    async getSectionMap(type = null, fileName) {
        const file = await this.getFile(type, fileName);
        return {
            type: file.type,
            fileName: file.fileName,
            rawMarkdown: file.rawMarkdown,
            sections: Object.fromEntries(file.sections.map((section) => [section.name, section.content])),
        };
    }

    async replaceFile(type = null, fileName, sections = {}) {
        if (!sections || typeof sections !== 'object' || Array.isArray(sections)) {
            throw new Error('replaceFile requires sections as an object.');
        }
        const location = this.#resolveFilePath(type, fileName);
        const normalizedSections = Object.entries(sections).map(([name, content]) => ({
            name: normalizeSectionName(name),
            content: normalizeSectionContent(content),
        })).filter((section) => section.name);
        const rawMarkdown = await this.#writeSections(location.filePath, normalizedSections);
        return {
            type: location.type,
            fileName: location.fileName,
            rawMarkdown,
            sections: toSectionList(normalizedSections),
        };
    }

    async appendToFile(type = null, fileName, payload = {}) {
        const { sections = {}, separator = '\n', dedupeLines = false } = payload ?? {};
        if (!sections || typeof sections !== 'object' || Array.isArray(sections)) {
            throw new Error('appendToFile requires payload.sections as an object.');
        }

        const location = this.#resolveFilePath(type, fileName);
        let existingSections = [];
        try {
            const existing = await this.#readSections(location.filePath);
            existingSections = existing.sections.map((section) => ({
                name: section.name,
                content: normalizeSectionContent(section.content),
            }));
        } catch (error) {
            if (!error || error.code !== 'ENOENT') {
                throw error;
            }
        }

        const entries = Object.entries(sections);
        for (const [selectorRaw, valueRaw] of entries) {
            const appendText = normalizeSectionContent(valueRaw);
            const selectorIndex = toIndexIfNumeric(selectorRaw);
            let targetIndex = -1;
            if (selectorIndex !== null) {
                targetIndex = selectorIndex - 1;
            } else {
                const selectorName = normalizeSectionName(selectorRaw);
                targetIndex = existingSections.findIndex(
                    (section) => section.name.toLowerCase() === selectorName.toLowerCase()
                );
            }

            if (targetIndex < 0 || targetIndex >= existingSections.length) {
                existingSections.push({
                    name: selectorIndex !== null ? `Section ${selectorIndex}` : normalizeSectionName(selectorRaw),
                    content: appendText,
                });
                continue;
            }

            const currentRaw = toRawSectionContent(existingSections[targetIndex].content);
            const appendRaw = toRawSectionContent(appendText);
            if (!appendRaw) {
                continue;
            }
            const merged = currentRaw ? `${currentRaw}${separator}${appendRaw}` : appendRaw;
            if (dedupeLines) {
                const unique = [];
                const seen = new Set();
                for (const line of merged.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)) {
                    if (seen.has(line)) {
                        continue;
                    }
                    seen.add(line);
                    unique.push(line);
                }
                existingSections[targetIndex].content = unique.length > 0 ? unique.join('\n') : '*None*';
            } else {
                existingSections[targetIndex].content = merged;
            }
        }

        const rawMarkdown = await this.#writeSections(location.filePath, existingSections);
        return {
            type: location.type,
            fileName: location.fileName,
            rawMarkdown,
            sections: toSectionList(existingSections),
        };
    }

    async getFileStats(type = null, fileName) {
        const location = this.#resolveFilePath(type, fileName);
        const stats = await fs.stat(location.filePath);
        return {
            type: location.type,
            fileName: location.fileName,
            stats,
        };
    }

    async updateFile(type = null, fileName, sections) {
        if (!sections || typeof sections !== 'object' || Array.isArray(sections)) {
            throw new Error('updateFile requires sections as an object.');
        }
        const entries = Object.entries(sections);
        if (entries.length === 0) {
            throw new Error('updateFile requires at least one section entry.');
        }

        const location = this.#resolveFilePath(type, fileName);
        let existingSections = [];
        try {
            const existing = await this.#readSections(location.filePath);
            existingSections = existing.sections;
        } catch (error) {
            if (!error || error.code !== 'ENOENT') {
                throw error;
            }
        }

        const working = existingSections.map((section) => ({
            name: section.name,
            content: normalizeSectionContent(section.content),
        }));
        const createdSections = [];
        const updatedSections = [];

        for (const [selectorRaw, valueRaw] of entries) {
            const appendText = normalizeSectionContent(valueRaw);
            const selectorIndex = toIndexIfNumeric(selectorRaw);
            let targetIndex = -1;
            if (selectorIndex !== null) {
                targetIndex = selectorIndex - 1;
            } else {
                const selectorName = normalizeSectionName(selectorRaw);
                targetIndex = working.findIndex(
                    (section) => section.name.toLowerCase() === selectorName.toLowerCase()
                );
            }

            if (targetIndex < 0 || targetIndex >= working.length) {
                const newSectionName = selectorIndex !== null
                    ? `Section ${selectorIndex}`
                    : normalizeSectionName(selectorRaw);
                working.push({
                    name: newSectionName,
                    content: appendText,
                });
                createdSections.push({ name: newSectionName });
                continue;
            }

            const currentContent = normalizeSectionContent(working[targetIndex].content);
            working[targetIndex].content = currentContent && appendText
                ? `${currentContent}\n${appendText}`
                : (appendText || currentContent);
            updatedSections.push({ name: working[targetIndex].name });
        }

        const rawMarkdown = await this.#writeSections(location.filePath, working);
        const normalizedSections = toSectionList(working);
        const sectionsByName = new Map(normalizedSections.map((section) => [section.name, section]));

        return {
            type: location.type,
            fileName: location.fileName,
            createdSections: createdSections
                .map((item) => sectionsByName.get(item.name))
                .filter(Boolean)
                .map(({ index, name }) => ({ index, name })),
            updatedSections: updatedSections
                .map((item) => sectionsByName.get(item.name))
                .filter(Boolean)
                .map(({ index, name }) => ({ index, name })),
            rawMarkdown,
        };
    }

    async deleteFile(type = null, fileName, sections = null) {
        const location = this.#resolveFilePath(type, fileName);
        if (!hasSelectors(sections)) {
            await fs.unlink(location.filePath);
            return {
                type: location.type,
                fileName: location.fileName,
                deletedFile: true,
            };
        }

        const record = await this.#readSections(location.filePath);
        const allSections = toSectionList(record.sections);
        const selectors = normalizeSelectors(sections);
        const deletedIndexSet = new Set();
        for (const selector of selectors) {
            const sectionIndex = findSectionIndex(allSections, selector);
            if (sectionIndex !== -1) {
                deletedIndexSet.add(sectionIndex);
            }
        }

        const deletedSections = [];
        const remainingSections = allSections.filter((section, index) => {
            if (!deletedIndexSet.has(index)) {
                return true;
            }
            deletedSections.push({ index: section.index, name: section.name });
            return false;
        });

        const rawMarkdown = await this.#writeSections(location.filePath, remainingSections);
        return {
            type: location.type,
            fileName: location.fileName,
            deletedSections,
            rawMarkdown,
        };
    }
}

export default MarkdownDataStore;
