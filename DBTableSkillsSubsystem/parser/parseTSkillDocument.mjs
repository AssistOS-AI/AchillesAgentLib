import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const SUBCHAPTER_ALIASES = new Map([
    ['description', 'description'],
    ['aliases', 'aliases'],
    ['alias', 'aliases'],
    ['field name presenter', 'fieldNamePresenter'],
    ['filed name presenter', 'fieldNamePresenter'],
    ['field presenter', 'fieldNamePresenter'],
    ['presenter', 'presenter'],
    ['resolver', 'resolver'],
    ['enumerator', 'enumerator'],
    ['validator', 'validator'],
    ['required', 'required'],
    ['requirement', 'required'],
    ['derivator', 'derivator'],
    ['primary key', 'primaryKey'],
    ['primarykey', 'primaryKey'],
    ['primary-key', 'primaryKey'],
    ['indexed', 'indexed'],
    ['index', 'indexed'],
    ['grouping', 'grouping'],
    ['group', 'grouping'],
]);

const BULLET_PATTERN = /^\s*[-*+]\s+(.*)$/;

const DEFAULT_SECTION = 'table-overview';
const TABLE_SECTION_ALIASES = new Map([
    ['table purpose', 'table-purpose'],
    ['purpose', 'table-purpose'],
    ['goal', 'table-purpose'],
    ['overview', DEFAULT_SECTION],
    ['summary', 'summary'],
]);

const normalizeWhitespace = (value = '') => value.replace(/\r/g, '');

const sanitizeKey = (value = '') => value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const toSnakeCase = (value = '') => value
    .trim()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((token, index) => (index === 0
        ? token.toLowerCase()
        : token.toLowerCase()))
    .join('_');

const toDisplayName = (value = '') => value
    .replace(/[_-]/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());

function normalizeSubchapterKey(heading = '') {
    const base = heading.trim().toLowerCase();
    const normalized = base.replace(/[:]+$/, '').trim();
    if (SUBCHAPTER_ALIASES.has(normalized)) {
        return SUBCHAPTER_ALIASES.get(normalized);
    }
    return null;
}

function parseBulletList(text = '') {
    const lines = normalizeWhitespace(text).split('\n');
    const items = [];
    for (const line of lines) {
        const match = line.match(BULLET_PATTERN);
        if (!match) {
            continue;
        }
        const entry = match[1].trim();
        if (entry) {
            items.push(entry);
        }
    }
    return items;
}

function parseAliasList(text = '') {
    const tokens = parseBulletList(text);
    if (tokens.length) {
        return tokens.map((token) => token.trim()).filter(Boolean);
    }
    return text
        .split(/[,;\n]/)
        .map((token) => token.trim())
        .filter(Boolean);
}

function parseEnumeratorSamples(text = '') {
    const rows = parseBulletList(text);
    if (!rows.length) {
        return [];
    }
    return rows.map((row) => {
        const [labelPart, ...rest] = row.split(/[:|-]/);
        const description = rest.join(':').trim();
        const label = labelPart.trim();
        if (!label && !description) {
            return null;
        }
        return {
            label: label || description,
            value: label || description,
            description,
        };
    }).filter(Boolean);
}

function parseGrouping(text = '') {
    if (!text || !text.trim()) {
        return null;
    }
    const lower = text.toLowerCase();
    const match = lower.match(/group\s*name\s*[:\-]\s*([a-z0-9_\-\s]+)/);
    if (match) {
        return {
            groupName: match[1].trim().replace(/\s+/g, '_'),
            description: text.trim(),
        };
    }
    return {
        groupName: sanitizeKey(text).replace(/-+/g, '_'),
        description: text.trim(),
    };
}

function tryParseFieldHeading(rawHeading = '') {
    const heading = rawHeading.trim();
    if (!heading) {
        return null;
    }

    const explicit = heading.match(/^field\s*[:\-]\s*(.+)$/i);
    if (explicit && explicit[1]) {
        return toSnakeCase(explicit[1]);
    }

    const prefix = heading.match(/^field\s+(.+)$/i);
    if (prefix && prefix[1]) {
        return toSnakeCase(prefix[1]);
    }

    if (/^.+\s+field$/i.test(heading)) {
        const name = heading.replace(/\s+field$/i, '').trim();
        if (name) {
            return toSnakeCase(name);
        }
    }

    if (/^[a-z0-9_]+$/i.test(heading)) {
        return toSnakeCase(heading);
    }

    return null;
}

function ensureFieldEntry(fields, name, order) {
    if (!fields.has(name)) {
        fields.set(name, {
            name,
            order,
            subchapters: {},
        });
    }
    return fields.get(name);
}

function assignFieldContent(fieldEntry, key, content) {
    if (!key) {
        return;
    }
    const trimmed = content.trim();
    if (!trimmed) {
        return;
    }
    fieldEntry.subchapters[key] = trimmed;
}

function buildFieldDefinitions(fieldMap = new Map()) {
    const fields = Array.from(fieldMap.values())
        .sort((a, b) => a.order - b.order)
        .map((entry) => {
            const subchapters = entry.subchapters || {};
            const description = subchapters.description || '';
            const aliases = parseAliasList(subchapters.aliases || '');
            const enumeratorSamples = parseEnumeratorSamples(subchapters.enumerator || '');
            const grouping = parseGrouping(subchapters.grouping || '');
            const namePresenter = subchapters.fieldNamePresenter || '';
            const displayName = namePresenter
                ? namePresenter.split('\n').find((line) => line.trim())?.trim()
                : null;
            return {
                name: entry.name,
                displayName: displayName || toDisplayName(entry.name),
                namePresenter,
                description,
                aliases,
                presenter: subchapters.presenter || '',
                resolver: subchapters.resolver || '',
                enumerator: subchapters.enumerator || '',
                enumeratorSamples,
                validator: subchapters.validator || '',
                required: subchapters.required || '',
                derivator: subchapters.derivator || '',
                primaryKey: subchapters.primaryKey || '',
                indexed: Boolean(subchapters.indexed && subchapters.indexed.trim()),
                grouping,
            };
        });

    const primaryKeys = fields
        .filter((field) => Boolean(field.primaryKey))
        .map((field) => field.name);

    const derivedFields = fields
        .filter((field) => Boolean(field.derivator))
        .map((field) => field.name);

    return {
        fields,
        fieldOrder: fields.map((field) => field.name),
        primaryKeys,
        derivedFields,
    };
}

/**
 * Parse a DB Table skill descriptor (tskill.md) into a structured blueprint.
 *
 * @param {string} filePath - Absolute path to the descriptor file.
 * @returns {{
 *   tableName: string,
 *   title: string,
 *   summary: string,
 *   overview: Record<string, string>,
 *   tablePurpose: string,
 *   fields: Array<object>,
 *   fieldOrder: Array<string>,
 *   primaryKeys: Array<string>,
 *   derivedFields: Array<string>,
 *   descriptorHash: string,
 *   raw: string
 * }}
 */
export function parseTSkillDocument(filePath) {
    if (!filePath) {
        throw new Error('parseTSkillDocument requires a descriptor file path.');
    }
    const absolutePath = path.resolve(filePath);
    const raw = fs.readFileSync(absolutePath, 'utf8');
    const content = normalizeWhitespace(raw);
    const lines = content.split('\n');

    let title = null;
    let summary = null;

    const overviewSections = new Map();
    let currentOverviewKey = DEFAULT_SECTION;
    overviewSections.set(currentOverviewKey, []);

    const fieldMap = new Map();
    let currentField = null;
    let currentSubchapter = null;
    let fieldOrder = 0;

    for (const line of lines) {
        const headingMatch = line.match(/^#{1,6}\s*(.+)$/);
        if (headingMatch) {
            const headingLevel = (line.match(/^#+/) || ['#'])[0].length;
            const headingText = headingMatch[1].trim();

            if (headingLevel === 1) {
                title = headingText;
                currentField = null;
                currentSubchapter = null;
                continue;
            }

            if (headingLevel === 2) {
                const fieldName = tryParseFieldHeading(headingText);
                if (fieldName) {
                    currentField = ensureFieldEntry(fieldMap, fieldName, fieldOrder);
                    fieldOrder += 1;
                    currentSubchapter = null;
                } else {
                    const lower = headingText.trim().toLowerCase();
                    currentField = null;
                    currentSubchapter = null;
                    currentOverviewKey = TABLE_SECTION_ALIASES.get(lower)
                        || sanitizeKey(headingText)
                        || DEFAULT_SECTION;
                    if (!overviewSections.has(currentOverviewKey)) {
                        overviewSections.set(currentOverviewKey, []);
                    }
                }
                continue;
            }

            if (headingLevel >= 3 && currentField) {
                const key = normalizeSubchapterKey(headingText);
                currentSubchapter = key;
                if (key && !currentField.subchapters[key]) {
                    currentField.subchapters[key] = '';
                }
                continue;
            }
        }

        if (!summary && line.trim()) {
            summary = line.trim();
        }

        if (currentField && currentSubchapter) {
            currentField.subchapters[currentSubchapter] = [
                currentField.subchapters[currentSubchapter],
                line,
            ].filter(Boolean).join('\n');
            continue;
        }

        if (currentField && !currentSubchapter) {
            const existing = currentField.subchapters.description || '';
            currentField.subchapters.description = [existing, line].filter(Boolean).join('\n');
            continue;
        }

        const buffer = overviewSections.get(currentOverviewKey) || [];
        buffer.push(line);
        overviewSections.set(currentOverviewKey, buffer);
    }

    const overview = {};
    overviewSections.forEach((buffer, key) => {
        const joined = buffer.join('\n').trim();
        if (joined) {
            overview[key] = joined;
        }
    });

    const tableName = title ? toSnakeCase(title) : path.basename(path.dirname(absolutePath));
    const descriptorHash = crypto.createHash('sha256').update(content).digest('hex');

    const fieldDefinitions = buildFieldDefinitions(fieldMap);

    return {
        tableName,
        title: title || path.basename(path.dirname(absolutePath)),
        summary: summary || '',
        overview,
        tablePurpose: overview['table-purpose'] || '',
        fields: fieldDefinitions.fields,
        fieldOrder: fieldDefinitions.fieldOrder,
        primaryKeys: fieldDefinitions.primaryKeys,
        derivedFields: fieldDefinitions.derivedFields,
        descriptorHash,
        raw: content,
    };
}

export default {
    parseTSkillDocument,
};
