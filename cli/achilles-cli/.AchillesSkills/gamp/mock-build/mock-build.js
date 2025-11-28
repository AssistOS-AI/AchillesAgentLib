import fs from 'node:fs';
import path from 'node:path';
import GampRSP from '../../../GampRSP.mjs';

const CORE_DOCS = [
    { type: 'URS', filename: 'URS.md' },
    { type: 'FS', filename: 'FS.md' },
    { type: 'NFS', filename: 'NFS.md' },
];

const readDocument = (name) => GampRSP.readDocument(name);

const extractChapters = (content) => {
    const regex = /^##\s+([A-Z]+-\d+)\s+–\s+(.*?)\n([\s\S]*?)(?=^##\s+[A-Z]+-\d+|$)/gim;
    const chapters = [];
    let match;
    while ((match = regex.exec(content)) !== null) {
        chapters.push({
            id: match[1].toUpperCase(),
            title: match[2].trim(),
            body: match[3].trim(),
        });
    }
    return chapters;
};

const extractSection = (body, heading) => {
    const pattern = new RegExp(`###\\s+${heading}[\\s\\S]*?(?=\\n###\\s+|$)`, 'i');
    const match = body.match(pattern);
    if (!match) {
        return '';
    }
    const cleaned = match[0]
        .split('\n')
        .slice(1)
        .join('\n')
        .trim();
    return cleaned;
};

const extractTraceEntries = (body) => {
    const trace = extractSection(body, 'Traceability');
    if (!trace) {
        return [];
    }
    return trace
        .split('\n')
        .map((line) => line.replace(/^-/, '').trim())
        .filter(Boolean);
};

const summariseCoreDoc = (type, filename) => {
    const content = readDocument(filename);
    const chapters = extractChapters(content);
    return chapters.map((chapter) => ({
        id: chapter.id,
        title: chapter.title,
        description: extractSection(chapter.body, 'Description') || chapter.body.split('\n').slice(0, 4).join(' ').trim(),
        traceability: extractTraceEntries(chapter.body),
        source: filename,
    }));
};

const extractTopHeading = (content) => {
    const match = content.match(/^#\s+(DS-\d+)\s+–\s+(.*)$/m);
    return match
        ? { id: match[1].toUpperCase(), title: match[2].trim() }
        : { id: 'DS-000', title: 'Design Specification' };
};

const extractBlock = (content, heading) => {
    const pattern = new RegExp(`##\\s+${heading}[\\s\\S]*?(?=\\n##\\s+|$)`, 'i');
    const match = content.match(pattern);
    if (!match) {
        return '';
    }
    return match[0].split('\n').slice(1).join('\n').trim();
};

const parseFileImpacts = (section) => {
    if (!section) {
        return [];
    }
    const regex = /###\s+File:\s+(.*?)\n([\s\S]*?)(?=###\s+File:|$)/gi;
    const files = [];
    let match;
    while ((match = regex.exec(section)) !== null) {
        const block = match[2];
        const parseDetail = (label) => {
            const pattern = new RegExp(`####\\s+${label}[\\s\\S]*?(?=\\n####\\s+|$)`, 'i');
            const detailMatch = block.match(pattern);
            if (!detailMatch) {
                return '';
            }
            return detailMatch[0].split('\n').slice(1).join('\n').trim();
        };
        files.push({
            path: match[1].trim(),
            why: parseDetail('Why'),
            how: parseDetail('How'),
            what: parseDetail('What'),
            description: parseDetail('Description'),
            exports: parseDetail('Exports').split('\n').map((line) => line.replace(/^-/, '').trim()).filter(Boolean),
            dependencies: parseDetail('Dependencies').split('\n').map((line) => line.replace(/^-/, '').trim()).filter(Boolean),
            sideEffects: parseDetail('Side Effects'),
            concurrency: parseDetail('Concurrency'),
        });
    }
    return files;
};

const parseTests = (section) => {
    if (!section) {
        return [];
    }
    const regex = /###\s+(TEST-\d+)\s+–\s+(.*?)\n([\s\S]*?)(?=###\s+TEST-|$)/gi;
    const tests = [];
    let match;
    while ((match = regex.exec(section)) !== null) {
        tests.push({
            id: match[1].toUpperCase(),
            title: match[2].trim(),
            description: match[3].trim(),
        });
    }
    return tests;
};

const summariseDesignSpecs = () => {
    const dsDir = GampRSP.getDSDir();
    if (!fs.existsSync(dsDir)) {
        return [];
    }
    return fs.readdirSync(dsDir)
        .filter((entry) => entry.toLowerCase().endsWith('.md'))
        .map((entry) => {
            const content = fs.readFileSync(path.join(dsDir, entry), 'utf8');
            const heading = extractTopHeading(content);
            const trace = extractBlock(content, 'Traceability')
                .split('\n')
                .map((line) => line.replace(/^-/, '').trim())
                .filter(Boolean);
            return {
                id: heading.id,
                title: heading.title,
                scope: extractBlock(content, 'Scope & Intent'),
                architecture: extractBlock(content, 'Architecture'),
                traceability: trace,
                files: parseFileImpacts(extractBlock(content, 'File Impact')),
                tests: parseTests(extractBlock(content, 'Tests')),
                file: entry,
            };
        });
};

const buildSummary = () => ({
    urs: summariseCoreDoc('URS', 'URS.md'),
    fs: summariseCoreDoc('FS', 'FS.md'),
    nfs: summariseCoreDoc('NFS', 'NFS.md'),
    ds: summariseDesignSpecs(),
});

const escapeHtml = (text = '') => text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

const renderList = (items, formatter) => {
    if (!items || !items.length) {
        return '<p>No entries yet.</p>';
    }
    return `<ul>
${items.map((item) => `<li>${formatter(item)}</li>`).join('\n')}
</ul>`;
};

const buildSummaryHtml = (summary) => {
    const renderCore = (label, entries) => `
    <section>
        <h2>${label}</h2>
        ${renderList(entries, (entry) => `<strong>${escapeHtml(entry.id)}</strong> – ${escapeHtml(entry.title)}<br/>${escapeHtml(entry.description)}`)}
    </section>`;

    const renderDS = summary.ds.map((entry) => `
    <section>
        <h3>${escapeHtml(entry.id)} – ${escapeHtml(entry.title)}</h3>
        <p>${escapeHtml(entry.scope || entry.architecture || '')}</p>
        <h4>Traceability</h4>
        ${renderList(entry.traceability, (line) => escapeHtml(line))}
        <h4>Files</h4>
        ${renderList(entry.files, (file) => `<strong>${escapeHtml(file.path)}</strong> – ${escapeHtml(file.why || '')}`)}
        <h4>Tests</h4>
        ${renderList(entry.tests, (test) => `<strong>${escapeHtml(test.id)}</strong> – ${escapeHtml(test.title)}`)}
    </section>`).join('\n');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Specification Summary</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 2rem; line-height: 1.6; }
    h1 { color: #003366; }
    section { margin-bottom: 2rem; }
    ul { padding-left: 1.2rem; }
  </style>
</head>
<body>
  <h1>Specification Summary</h1>
  ${renderCore('URS', summary.urs)}
  ${renderCore('FS', summary.fs)}
  ${renderCore('NFS', summary.nfs)}
  <section>
    <h2>Design Specifications</h2>
    ${renderDS || '<p>No DS entries yet.</p>'}
  </section>
</body>
</html>`;
};

export async function action({ context = {} }) {
    const workspaceRoot = context.workspaceRoot || process.cwd();
    GampRSP.configure(workspaceRoot);
    const summary = buildSummary();
    const mockDir = GampRSP.getMockDir();
    const summaryPath = path.join(mockDir, 'spec-summary.html');
    const docsDir = GampRSP.generateHtmlDocs();
    fs.mkdirSync(mockDir, { recursive: true });
    fs.writeFileSync(summaryPath, buildSummaryHtml(summary));
    const docsIndex = path.join(docsDir, 'index.html');
    return {
        message: 'Specification summary generated.',
        type: 'spec-summary',
        output: summaryPath,
        docsIndex,
        specs: summary,
    };
}

export default action;
