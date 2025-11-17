import fs from 'node:fs';
import path from 'node:path';

const VERSION_HEADER = (title) => `# ${title}\n\n## Version\n- current: v1.0\n- timestamp: ${Date.now()}\n`;

const DEFAULT_DOCS = [
    { filename: 'URS.md', title: 'User Requirements Specification' },
    { filename: 'FS.md', title: 'Functional Specification' },
    { filename: 'NFS.md', title: 'Non-Functional Specification' },
];

const normaliseId = (value) => {
    if (!value || typeof value !== 'string') {
        return '';
    }
    return value.trim().toUpperCase();
};

const requirementDocName = (reqId) => {
    const normalised = normaliseId(reqId);
    if (normalised.startsWith('FS-')) {
        return 'FS.md';
    }
    if (normalised.startsWith('NFS-')) {
        return 'NFS.md';
    }
    return null;
};

const ensureDir = (dirPath) => {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
};

const readFileSafe = (filePath, fallback = '') => {
    try {
        return fs.readFileSync(filePath, 'utf8');
    } catch {
        return fallback;
    }
};

const writeFileSafe = (filePath, content) => {
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, content);
};

const nextId = (existingIds, prefix) => {
    const numbers = existingIds
        .map((id) => {
            const match = id.match(/-(\d+)$/);
            return match ? Number(match[1]) : 0;
        })
        .filter(Number.isFinite);
    const nextNumber = numbers.length ? Math.max(...numbers) + 1 : 1;
    return `${prefix}-${String(nextNumber).padStart(3, '0')}`;
};

const extractChapters = (content) => {
    const regex = /^##\s+(.*?)$/gm;
    const matches = [];
    let match;
    while ((match = regex.exec(content)) !== null) {
        matches.push({
            heading: match[1].trim(),
            start: match.index,
        });
    }

    return matches.map((entry, index) => {
        const end = index + 1 < matches.length
            ? matches[index + 1].start
            : content.length;
        return {
            heading: entry.heading,
            body: content.slice(entry.start, end).trim(),
            start: entry.start,
            end,
        };
    });
};

const replaceChapter = (content, heading, newBody) => {
    const chapters = extractChapters(content);
    const chapter = chapters.find((entry) => entry.heading.startsWith(heading));
    if (!chapter) {
        return `${content.trim()}\n\n${newBody.trim()}\n`;
    }
    return `${content.slice(0, chapter.start)}${newBody.trim()}\n${content.slice(chapter.end)}`;
};

const buildChapter = ({ id, title, description, extra = '' }) => [
    `## ${id} – ${title}`,
    `Version: v1.0 (${Date.now()})`,
    'Status: active',
    '',
    '### Description',
    description || 'Pending elaboration.',
    extra ? `\n${extra.trim()}\n` : '',
].join('\n').trim();

const ensureTraceabilityBlock = ({
    ursId = 'TBD',
    dsIds = [],
    label = 'Traceability',
}) => {
    const linkedDs = Array.from(new Set(dsIds.map((entry) => normaliseId(entry)).filter(Boolean)));
    const dsValue = linkedDs.length ? linkedDs.join(', ') : 'pending';
    return [
        `### ${label}`,
        `- Source URS: ${normaliseId(ursId) || 'TBD'}`,
        `- Linked DS: ${dsValue}`,
    ].join('\n');
};

const slugifyTitle = (value) => {
    if (!value || typeof value !== 'string') {
        return 'design';
    }
    const cleaned = value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return cleaned || 'design';
};

const extractDSIdFromFileName = (fileName) => {
    if (!fileName) {
        return null;
    }
    const match = fileName.match(/(DS-\d+)/i);
    return match ? match[1].toUpperCase() : null;
};

class GampRSP {
    constructor() {
        this.workspaceRoot = process.cwd();
        this.specsDir = path.join(this.workspaceRoot, '.specs');
        this.initialised = false;
    }

    configure(workspaceRoot = process.cwd()) {
        this.workspaceRoot = workspaceRoot;
        this.specsDir = path.join(workspaceRoot, '.specs');
        this.initialised = false;
        this.ensureWorkspace();
    }

    ensureWorkspace() {
        if (this.initialised) {
            return;
        }
        ensureDir(this.specsDir);
        DEFAULT_DOCS.forEach(({ filename, title }) => {
            const target = path.join(this.specsDir, filename);
            if (!fs.existsSync(target)) {
                writeFileSafe(target, VERSION_HEADER(title));
            }
        });
        ensureDir(this.getDSDir());
        ensureDir(this.getMockDir());
        ensureDir(this.getDocsDir());
        const ignorePath = this.getIgnorePath();
        if (!fs.existsSync(ignorePath)) {
            writeFileSafe(ignorePath, ['node_modules', '.git', 'dist', 'coverage'].join('\n'));
        }
        this.initialised = true;
    }

    getDocPath(name) {
        return path.join(this.specsDir, name);
    }

    getSpecsDirectory() {
        this.ensureWorkspace();
        return this.specsDir;
    }

    getDSDir() {
        return path.join(this.specsDir, 'DS');
    }

    resolveDSFilePath(dsId, { title = '' } = {}) {
        const normalised = normaliseId(dsId);
        if (!normalised) {
            throw new Error('resolveDSFilePath requires a DS identifier.');
        }
        const dsDir = this.getDSDir();
        ensureDir(dsDir);
        const entries = fs.readdirSync(dsDir);
        const match = entries.find((entry) => entry.toUpperCase().startsWith(`${normalised}-`));
        if (match) {
            return path.join(dsDir, match);
        }
        const legacyName = `${normalised}.md`;
        const legacyPath = path.join(dsDir, legacyName);
        if (fs.existsSync(legacyPath)) {
            return legacyPath;
        }
        const slug = slugifyTitle(title || normalised);
        return path.join(dsDir, `${normalised}-${slug}.md`);
    }

    getDSFilePath(dsId) {
        return this.resolveDSFilePath(dsId);
    }

    getMockDir() {
        return path.join(this.specsDir, 'mock');
    }

    getDocsDir() {
        return path.join(this.specsDir, 'html_docs');
    }

    getIgnorePath() {
        return path.join(this.specsDir, '.ignore');
    }

    readDocument(name) {
        this.ensureWorkspace();
        return readFileSafe(this.getDocPath(name), VERSION_HEADER(name.replace('.md', '')));
    }

    writeDocument(name, content) {
        this.ensureWorkspace();
        writeFileSafe(this.getDocPath(name), content);
    }

    collectIds(docName, prefix) {
        const content = this.readDocument(docName);
        const chapters = extractChapters(content);
        return chapters
            .map((chapter) => {
                const match = chapter.heading.match(/(URS|FS|NFS)-\d+/i);
                return match ? match[0].toUpperCase() : null;
            })
            .filter((id) => id && id.startsWith(prefix));
    }

    createURS(title, description) {
        const docName = 'URS.md';
        const ids = this.collectIds(docName, 'URS');
        const id = nextId(ids, 'URS');
        const chapter = buildChapter({ id, title, description });
        const content = this.readDocument(docName);
        this.writeDocument(docName, `${content.trim()}\n\n${chapter}\n`);
        return id;
    }

    updateURS(id, title, description) {
        const docName = 'URS.md';
        const chapter = buildChapter({ id, title, description });
        const content = this.readDocument(docName);
        const updated = replaceChapter(content, id, chapter);
        this.writeDocument(docName, updated);
    }

    retireURS(id) {
        const docName = 'URS.md';
        const content = this.readDocument(docName);
        const chapters = extractChapters(content);
        const chapter = chapters.find((entry) => entry.heading.startsWith(id));
        if (!chapter) {
            return;
        }
        const updated = chapter.body.replace('Status: active', 'Status: retired');
        const newBody = `## ${id} – ${chapter.heading.split('–')[1].trim()}\n${updated.split('\n').slice(1).join('\n')}`;
        this.writeDocument(docName, replaceChapter(content, id, newBody));
    }

    createFS(title, description, ursId, reqId = null, linkedDs = []) {
        const docName = 'FS.md';
        const ids = this.collectIds(docName, 'FS');
        const id = reqId || nextId(ids, 'FS');
        const extra = ensureTraceabilityBlock({
            ursId,
            dsIds: linkedDs,
            label: 'Traceability',
        });
        const chapter = buildChapter({ id, title, description, extra });
        const content = this.readDocument(docName);
        this.writeDocument(docName, `${content.trim()}\n\n${chapter}\n`);
        return id;
    }

    updateFS(id, title, description, ursId, linkedDs = []) {
        const extra = ensureTraceabilityBlock({
            ursId,
            dsIds: linkedDs,
            label: 'Traceability',
        });
        const chapter = buildChapter({ id, title, description, extra });
        const updated = replaceChapter(this.readDocument('FS.md'), id, chapter);
        this.writeDocument('FS.md', updated);
    }

    obsoleteFS(id) {
        this.retireGeneric('FS.md', id);
    }

    createNFS(title, description, ursId, reqId = null, linkedDs = []) {
        const docName = 'NFS.md';
        const ids = this.collectIds(docName, 'NFS');
        const id = reqId || nextId(ids, 'NFS');
        const extra = [
            '### Quality Envelope',
            '- Attribute: pending',
            `- Linked URS: ${normaliseId(ursId) || 'TBD'}`,
            `- Linked DS: ${linkedDs.length ? linkedDs.map((entry) => normaliseId(entry)).filter(Boolean).join(', ') : 'pending'}`,
        ].join('\n');
        const chapter = buildChapter({ id, title, description, extra });
        const content = this.readDocument(docName);
        this.writeDocument(docName, `${content.trim()}\n\n${chapter}\n`);
        return id;
    }

    updateNFS(id, title, description, ursId, linkedDs = []) {
        const extra = [
            '### Quality Envelope',
            '- Attribute: pending',
            `- Linked URS: ${normaliseId(ursId) || 'TBD'}`,
            `- Linked DS: ${linkedDs.length ? linkedDs.map((entry) => normaliseId(entry)).filter(Boolean).join(', ') : 'pending'}`,
        ].join('\n');
        const chapter = buildChapter({ id, title, description, extra });
        const updated = replaceChapter(this.readDocument('NFS.md'), id, chapter);
        this.writeDocument('NFS.md', updated);
    }

    obsoleteNFS(id) {
        this.retireGeneric('NFS.md', id);
    }

    retireGeneric(docName, id) {
        const content = this.readDocument(docName);
        const chapters = extractChapters(content);
        const chapter = chapters.find((entry) => entry.heading.startsWith(id));
        if (!chapter) {
            return;
        }
        const updated = chapter.body.replace('Status: active', 'Status: retired');
        const newBody = `## ${id} – ${chapter.heading.split('–')[1].trim()}\n${updated.split('\n').slice(1).join('\n')}`;
        this.writeDocument(docName, replaceChapter(content, id, newBody));
    }

    createDS(title, description, architecture, ursId, reqId) {
        const ids = this.listDSIds();
        const id = nextId(ids, 'DS');
        const timestamp = Date.now();
        const payload = [
            `# ${id} – ${title}`,
            '',
            '## Version',
            '- current: v1.0',
            `- timestamp: ${timestamp}`,
            '',
            '## Scope & Intent',
            description || 'Pending design elaboration.',
            '',
            '## Architecture',
            architecture || 'Architecture TBD.',
            '',
            '## Traceability',
            `- URS: ${ursId || 'TBD'}`,
            `- Requirement: ${reqId || 'TBD'}`,
            '',
            '## File Impact',
            '_File-level impact entries appear here._',
            '',
            '## Tests',
            '_Add tests via createTest()._',
        ].join('\n');
        const target = this.resolveDSFilePath(id, { title });
        writeFileSafe(target, payload);
        this.linkRequirementToDS(reqId, id);
        return id;
    }

    updateDS(id, title, description, architecture) {
        const filePath = this.resolveDSFilePath(id, { title });
        if (!fs.existsSync(filePath)) {
            throw new Error(`DS file ${id} not found.`);
        }
        const content = readFileSafe(filePath);
        const updated = replaceChapter(
            replaceChapter(content, 'Scope & Intent', `## Scope & Intent\n${description || 'Pending design elaboration.'}`),
            'Architecture',
            `## Architecture\n${architecture || 'Architecture TBD.'}`,
        );
        writeFileSafe(filePath, updated);
    }

    listDSIds() {
        ensureDir(this.getDSDir());
        const entries = fs.readdirSync(this.getDSDir());
        return entries
            .map((entry) => extractDSIdFromFileName(entry))
            .filter(Boolean);
    }

    createTest(dsId, title, description) {
        const testId = this.nextTestId();
        const block = [
            `### ${testId} – ${title}`,
            `Folder: tests/specs/${testId.toLowerCase()}`,
            `Main Script: run-${testId.toLowerCase()}.mjs`,
            '',
            description || 'Test description pending.',
        ].join('\n');
        this.appendToDS(dsId, block, '## Tests');
        return testId;
    }

    updateTest(testId, title, folder, mainFile, description) {
        const dsFile = this.findDSByTest(testId);
        if (!dsFile) {
            throw new Error(`Test ${testId} not found in any DS.`);
        }
        const content = readFileSafe(dsFile);
        const pattern = new RegExp(`###\\s+${testId}\\b[\\s\\S]+?(?=\\n###\\s+TEST-|$)`, 'i');
        const replacement = [
            `### ${testId} – ${title}`,
            `Folder: ${folder}`,
            `Main Script: ${mainFile}`,
            '',
            description || 'Test description pending.',
        ].join('\n');
        const updated = content.replace(pattern, replacement);
        writeFileSafe(dsFile, updated);
    }

    deleteTest(testId) {
        const dsFile = this.findDSByTest(testId);
        if (!dsFile) {
            return;
        }
        const content = readFileSafe(dsFile);
        const pattern = new RegExp(`\\n###\\s+${testId}\\b[\\s\\S]+?(?=\\n###\\s+TEST-|$)`, 'i');
        const updated = content.replace(pattern, '\n');
        writeFileSafe(dsFile, updated);
    }

    nextTestId() {
        const records = [];
        const dsDir = this.getDSDir();
        ensureDir(dsDir);
        fs.readdirSync(dsDir).forEach((entry) => {
            const text = readFileSafe(path.join(dsDir, entry));
            const matches = text.match(/TEST-\d+/gi);
            if (matches) {
                records.push(...matches.map((token) => token.toUpperCase()));
            }
        });
        return nextId(records, 'TEST');
    }

    findDSByTest(testId) {
        const dsDir = this.getDSDir();
        const entries = fs.readdirSync(dsDir);
        return entries
            .map((entry) => path.join(dsDir, entry))
            .find((filePath) => {
                const text = readFileSafe(filePath);
                return text.includes(`### ${testId}`) || text.includes(`### ${testId.toUpperCase()}`);
            }) || null;
    }

    appendToDS(dsId, block, anchor) {
        const filePath = this.resolveDSFilePath(dsId);
        const content = readFileSafe(filePath);
        const pattern = new RegExp(`${anchor}[\\s\\S]*?(?=\\n##\\s+|$)`, 'i');
        const match = content.match(pattern);
        if (!match) {
            writeFileSafe(filePath, `${content.trim()}\n\n${anchor}\n${block}\n`);
            return;
        }
        const replaced = content.replace(pattern, `${match[0].trim()}\n\n${block}`);
        writeFileSafe(filePath, replaced);
    }

    describeFile(dsId, filePath, description, exports = [], dependencies = [], options = {}) {
        const meta = (options && typeof options === 'object' && !Array.isArray(options))
            ? options
            : {};
        const why = meta.why || description || 'Purpose pending.';
        const how = meta.how || 'Implementation details will follow DS guidance.';
        const what = meta.what || 'Resulting artifact captured by this DS.';
        const sideEffects = meta.sideEffects || 'None noted.';
        const concurrency = meta.concurrency || 'Not specified.';
        const payload = [
            `### File: ${filePath}`,
            `Timestamp: ${Date.now()}`,
            '',
            '#### Why',
            why,
            '',
            '#### How',
            how,
            '',
            '#### What',
            what,
            '',
            '#### Description',
            description || 'Pending description.',
            '',
            '#### Exports',
            exports.length ? exports.map((item) => `- ${item}`).join('\n') : '- none',
            '',
            '#### Dependencies',
            dependencies.length ? dependencies.map((item) => `- ${item}`).join('\n') : '- none',
            '',
            '#### Side Effects',
            sideEffects,
            '',
            '#### Concurrency',
            concurrency,
        ].join('\n');
        this.appendToDS(dsId, payload, '## File Impact');
        return payload;
    }

    linkRequirementToDS(reqId, dsId) {
        const targetDoc = requirementDocName(reqId);
        if (!targetDoc) {
            return;
        }
        const normalisedReq = normaliseId(reqId);
        const content = this.readDocument(targetDoc);
        const chapters = extractChapters(content);
        const chapter = chapters.find((entry) => normaliseId(entry.heading).startsWith(normalisedReq));
        if (!chapter) {
            return;
        }
        const dsToken = normaliseId(dsId);
        if (!dsToken) {
            return;
        }
        const lines = chapter.body.split('\n');
        const dsLineIndex = lines.findIndex((line) => /- (Linked\s+)?DS:/i.test(line.trim()));
        if (dsLineIndex >= 0) {
            const existing = lines[dsLineIndex].split(':').slice(1).join(':');
            const tokens = existing.split(',').map((entry) => normaliseId(entry)).filter(Boolean);
            if (!tokens.includes(dsToken)) {
                tokens.push(dsToken);
            }
            lines[dsLineIndex] = `- Linked DS: ${tokens.join(', ')}`;
        } else {
            const traceIdx = lines.findIndex((line) => line.trim().startsWith('### Traceability') || line.trim().startsWith('### Quality Envelope'));
            let insertionIdx = traceIdx >= 0 ? traceIdx + 1 : lines.length;
            while (insertionIdx < lines.length && lines[insertionIdx].trim().startsWith('- ')) {
                insertionIdx += 1;
            }
            lines.splice(insertionIdx, 0, `- Linked DS: ${dsToken}`);
        }
        const updatedBody = lines.join('\n');
        const updatedContent = content.replace(chapter.body, updatedBody);
        this.writeDocument(targetDoc, updatedContent);
    }

    loadSpecs(filterText = '') {
        this.ensureWorkspace();
        const docs = DEFAULT_DOCS.map(({ filename }) => ({
            name: filename.replace('.md', ''),
            content: readFileSafe(this.getDocPath(filename)),
        }));
        const dsEntries = fs.readdirSync(this.getDSDir()).map((entry) => ({
            name: entry.replace('.md', ''),
            content: readFileSafe(path.join(this.getDSDir(), entry)),
        }));
        const combined = [...docs, ...dsEntries];
        if (!filterText) {
            return combined.map((entry) => `# ${entry.name}\n${entry.content}`).join('\n\n');
        }
        return combined
            .filter((entry) => entry.content.toLowerCase().includes(filterText.toLowerCase()))
            .map((entry) => `# ${entry.name}\n${entry.content}`)
            .join('\n\n');
    }

    readIgnoreList() {
        return readFileSafe(this.getIgnorePath(), '')
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean);
    }

    addIgnoreEntries(entries = []) {
        const list = new Set(this.readIgnoreList());
        entries.forEach((entry) => {
            if (entry) {
                list.add(entry.trim());
            }
        });
        writeFileSafe(this.getIgnorePath(), Array.from(list).join('\n'));
        return Array.from(list);
    }

    getCachePath() {
        return path.join(this.specsDir, '.gamp-cache.json');
    }

    readCache() {
        const cachePath = this.getCachePath();
        if (!fs.existsSync(cachePath)) {
            return {};
        }
        try {
            return JSON.parse(fs.readFileSync(cachePath, 'utf8'));
        } catch {
            return {};
        }
    }

    writeCache(data = {}) {
        writeFileSafe(this.getCachePath(), `${JSON.stringify(data, null, 2)}\n`);
    }

    generateHtmlDocs() {
        const docsDir = this.getDocsDir();
        ensureDir(docsDir);
        const html = (title, body) => `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>${title}</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 2rem; line-height: 1.5; }
        pre { background: #f4f4f4; padding: 1rem; overflow-x: auto; }
        h1, h2, h3 { color: #003366; }
        ul { line-height: 1.8; }
        a { color: #0050a4; text-decoration: none; }
    </style>
</head>
<body>
${body}
</body>
</html>`;
        const extractTitle = (content, fallback) => {
            const match = content.match(/^#\s+(.+)$/m);
            return match ? match[1].trim() : fallback;
        };
        const extractDescription = (content) => {
            const match = content.match(/###\s+Description\s+([\s\S]+?)(?:\n###|\n$)/i);
            if (match) {
                return match[1].trim().replace(/\n+/g, ' ');
            }
            return '';
        };
        const pages = [];
        const addPage = (href, title, section, description = '') => {
            pages.push({ href, title, section, description });
        };

        const files = [
            { name: 'URS.html', source: 'URS.md' },
            { name: 'FS.html', source: 'FS.md' },
            { name: 'NFS.html', source: 'NFS.md' },
        ];
        files.forEach(({ name, source }) => {
            const content = readFileSafe(this.getDocPath(source));
            const title = extractTitle(content, source.replace('.md', '').toUpperCase());
            writeFileSafe(path.join(docsDir, name), html(title, `<pre>${content}</pre>`));
            addPage(name, title, 'core', extractDescription(content));
        });

        const dsEntries = fs.readdirSync(this.getDSDir())
            .filter((entry) => entry.toLowerCase().endsWith('.md'))
            .sort();
        dsEntries.forEach((entry) => {
            const content = readFileSafe(path.join(this.getDSDir(), entry));
            const heading = extractTitle(content, entry.replace('.md', ''));
            const name = `${entry.replace('.md', '')}.html`;
            writeFileSafe(path.join(docsDir, name), html(heading, `<pre>${content}</pre>`));
            addPage(name, heading, 'ds', extractDescription(content));
        });

        const renderList = (heading, filter) => {
            const entries = pages.filter((page) => page.section === filter);
            if (!entries.length) {
                return '';
            }
            const items = entries
                .map((page) => `<li><a href="${page.href}">${page.title}</a>${page.description ? ` – ${page.description}` : ''}</li>`)
                .join('\n');
            return `<h2>${heading}</h2>\n<ul>\n${items}\n</ul>`;
        };

        const indexBody = [
            '<h1>Specification Index</h1>',
            renderList('Core Specifications', 'core'),
            renderList('Design Specifications', 'ds'),
        ].filter(Boolean).join('\n\n');
        writeFileSafe(path.join(docsDir, 'index.html'), html('Specification Index', indexBody));
        return docsDir;
    }
}

const singleton = new GampRSP();
export default singleton;
