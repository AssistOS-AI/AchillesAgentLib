import fs from 'node:fs';
import path from 'node:path';

import GampRSP from '../GampRSP.mjs';

export const resolveSpecTargets = (cli, query = '') => {
    const normalized = (query || '').toLowerCase();
    const wantAll = !normalized || /toate/.test(normalized) || /spec|specific|cerin|requirement|document/i.test(normalized);
    const matchIds = (prefix) => Array.from(new Set(
        (query.match(new RegExp(`${prefix}-\\d+`, 'gi')) || [])
            .map((id) => id.toUpperCase()),
    ));
    const dsIds = Array.from(new Set(
        (query.match(/ds-\d+/gi) || []).map((id) => id.toUpperCase()),
    ));
    return {
        wantURS: wantAll || normalized.includes('urs') || matchIds('URS').length > 0,
        wantFS: wantAll || normalized.includes('fs') || matchIds('FS').length > 0,
        wantNFS: wantAll || normalized.includes('nfs') || matchIds('NFS').length > 0,
        wantDS: wantAll || normalized.includes('ds') || dsIds.length > 0,
        dsIds,
        ids: {
            urs: matchIds('URS'),
            fs: matchIds('FS'),
            nfs: matchIds('NFS'),
        },
        listAll: wantAll,
    };
};

const parseSpecSections = (content) => {
    const lines = content.split(/\r?\n/);
    const sections = [];
    let current = null;
    lines.forEach((line) => {
        if (line.startsWith('## ')) {
            if (current) {
                sections.push(current);
            }
            current = {
                heading: line.replace(/^##\s+/, '').trim(),
                body: [],
            };
        } else if (current) {
            current.body.push(line);
        }
    });
    if (current) {
        sections.push(current);
    }
    return sections;
};

const extractSectionDescription = (bodyLines = []) => {
    const text = bodyLines.join('\n');
    const match = text.match(/###\s+Description([\s\S]+?)(?:\n###|\n$)/i);
    if (match) {
        return match[1].trim().replace(/\n+/g, ' ');
    }
    const firstSentence = bodyLines.find((line) => line && !line.startsWith('#'));
    return firstSentence ? firstSentence.trim() : '';
};

export const summarizeSpecDocument = (cli, fileName, type, filterIds = []) => {
    const filePath = path.join(cli.specsRoot, fileName);
    if (!fs.existsSync(filePath)) {
        return [];
    }
    const content = fs.readFileSync(filePath, 'utf8');
    const sections = parseSpecSections(content);
    const filterSet = new Set(filterIds);
    const entries = [];

    sections.forEach((section) => {
        const idMatch = section.heading.match(/(URS|FS|NFS)-\d+/i);
        const sectionId = idMatch ? idMatch[0].toUpperCase() : null;
        if (!sectionId) {
            return;
        }
        if (filterSet.size && !filterSet.has(sectionId)) {
            return;
        }
        const title = section.heading.includes('–')
            ? section.heading.split('–')[1].trim()
            : section.heading;
        const trace = section.body
            .filter((line) => /^-\s+(Source|Linked)/i.test(line.trim()))
            .map((line) => line.trim());
        const description = extractSectionDescription(section.body);
        entries.push({
            type,
            id: sectionId || `${type} section`,
            title,
            description: description && description !== title ? description : '',
            trace,
            path: filePath,
        });
    });

    if (!entries.length && !filterSet.size) {
        entries.push({
            type,
            id: `${type} summary`,
            title: fileName,
            description: (content.split('\n')[0] || '').trim(),
            path: filePath,
        });
    }

    return entries;
};

export const listRecentDSIds = (cli, limit = 5) => {
    const dsDir = path.join(cli.specsRoot, 'DS');
    if (!fs.existsSync(dsDir)) {
        return [];
    }
    return fs.readdirSync(dsDir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.md'))
        .map((entry) => ({
            name: entry.name,
            mtime: fs.statSync(path.join(dsDir, entry.name)).mtimeMs,
        }))
        .sort((a, b) => b.mtime - a.mtime)
        .slice(0, Number.isFinite(limit) ? limit : undefined)
        .map((item) => {
            const match = item.name.match(/(DS-\d+)/i);
            return match ? match[1].toUpperCase() : null;
        })
        .filter(Boolean);
};

const extractBlock = (lines, marker) => {
    const index = lines.findIndex((line) => line.trim().toLowerCase() === marker.toLowerCase());
    if (index === -1) {
        return '';
    }
    const body = [];
    for (let i = index + 1; i < lines.length; i += 1) {
        if (lines[i].startsWith('## ')) {
            break;
        }
        body.push(lines[i]);
    }
    return body.join('\n').trim();
};

export const summarizeDesignSpecs = (dsIds = []) => {
    const entries = [];
    dsIds.forEach((dsId) => {
        try {
            const filePath = GampRSP.getDSFilePath(dsId);
            const content = fs.readFileSync(filePath, 'utf8');
            const lines = content.split(/\r?\n/);
            const heading = lines.find((line) => line.startsWith('# ')) || `${dsId}`;
            const title = heading.includes('–') ? heading.split('–')[1].trim() : heading.replace(/^#\s+/, '').trim();
            const scope = extractBlock(lines, '## Scope & Intent') || extractBlock(lines, '## Description');
            const architecture = extractBlock(lines, '## Architecture');
            const traceInfo = lines
                .filter((line) => /^-\s+(URS|Requirement)/i.test(line.trim()))
                .map((line) => line.trim());
            entries.push({
                type: 'DS',
                id: dsId,
                title,
                description: [scope, architecture].filter(Boolean).join(' | ') || '',
                path: filePath,
                trace: traceInfo,
            });
        } catch {
            // ignore DS read errors
        }
    });
    return entries;
};

const SECTION_FILE_MAP = {
    urs: 'URS.md',
    fs: 'FS.md',
    nfs: 'NFS.md',
};

const extractSectionText = (content, sectionId) => {
    const pattern = new RegExp(`##\\s+${sectionId}\\b[\\s\\S]*?(?=\\n##\\s+[A-Z]+-\\d+|$)`, 'i');
    const match = content.match(pattern);
    return match ? match[0].trim() : '';
};

export const getSectionTextById = (cli, sectionId) => {
    if (!sectionId) {
        return '';
    }
    const normalized = sectionId.toUpperCase();
    if (normalized.startsWith('DS-')) {
        try {
            const dsPath = GampRSP.resolveDSFilePath(normalized);
            return fs.readFileSync(dsPath, 'utf8');
        } catch {
            return '';
        }
    }
    const docType = normalized.startsWith('URS')
        ? 'urs'
        : (normalized.startsWith('FS') ? 'fs' : (normalized.startsWith('NFS') ? 'nfs' : null));
    if (!docType) {
        return '';
    }
    const fileName = SECTION_FILE_MAP[docType];
    const target = path.join(cli.specsRoot, fileName);
    if (!fs.existsSync(target)) {
        return '';
    }
    const content = fs.readFileSync(target, 'utf8');
    return extractSectionText(content, normalized) || '';
};

export const describeSpecs = (cli, targets) => {
    const sections = [];
    if (targets.wantURS) {
        summarizeSpecDocument(cli, 'URS.md', 'URS', targets.ids.urs).forEach((entry) => {
            sections.push({
                ...entry,
                text: getSectionTextById(cli, entry.id),
            });
        });
    }
    if (targets.wantFS) {
        summarizeSpecDocument(cli, 'FS.md', 'FS', targets.ids.fs).forEach((entry) => {
            sections.push({
                ...entry,
                text: getSectionTextById(cli, entry.id),
            });
        });
    }
    if (targets.wantNFS) {
        summarizeSpecDocument(cli, 'NFS.md', 'NFS', targets.ids.nfs).forEach((entry) => {
            sections.push({
                ...entry,
                text: getSectionTextById(cli, entry.id),
            });
        });
    }
    if (targets.wantDS) {
        const dsIds = targets.dsIds.length ? targets.dsIds : listRecentDSIds(cli, 5);
        dsIds.forEach((dsId) => {
            sections.push({
                type: 'DS',
                id: dsId,
                title: dsId,
                text: getSectionTextById(cli, dsId),
            });
        });
    }
    return sections;
};

export default {
    resolveSpecTargets,
    summarizeSpecDocument,
    listRecentDSIds,
    summarizeDesignSpecs,
    getSectionTextById,
    describeSpecs,
};
