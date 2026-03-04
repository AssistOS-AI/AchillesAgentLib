import fs from 'node:fs/promises';

const DS_SECTIONS = [
    'Vision and Problem Statement',
    'Intended Users and Context of Use',
    'Scope and Boundaries',
    'Success Criteria',
    'Affected Files',
];

const FDS_SECTIONS = [
    'Description',
    'Dependencies',
    'Main Functions',
    'Exports',
    'Implementation Details',
    'Testing',
];

const DS_STRUCTURE = {
    type: 'DS',
    sections: DS_SECTIONS,
};

const FDS_STRUCTURE = {
    type: 'FDS',
    sections: FDS_SECTIONS,
};

function parseSections(content) {
    const lines = content.split(/\r?\n/);
    const sections = new Map();
    let current = null;
    let buffer = [];

    const flush = () => {
        if (!current) return;
        sections.set(current, buffer.join('\n').trim());
        buffer = [];
    };

    for (const line of lines) {
        const headingMatch = line.match(/^(#{1,6})\s+(.+?)\s*$/);
        if (headingMatch) {
            flush();
            current = headingMatch[2].trim();
            continue;
        }
        if (current) {
            buffer.push(line);
        }
    }
    flush();

    return sections;
}

function updateSectionContent(content, sectionName, newText) {
    const lines = content.split(/\r?\n/);
    const output = [];
    let inTarget = false;
    let targetLevel = null;
    let replaced = false;

    const sectionHeader = `## ${sectionName}`;
    const newLines = [sectionHeader, '', newText.trim()];

    for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        const headingMatch = line.match(/^(#{1,6})\s+(.+?)\s*$/);
        if (headingMatch) {
            const level = headingMatch[1].length;
            const name = headingMatch[2].trim();

            if (inTarget && level <= targetLevel) {
                inTarget = false;
            }

            if (name === sectionName) {
                if (!replaced) {
                    output.push(...newLines);
                    replaced = true;
                }
                inTarget = true;
                targetLevel = level;
                continue;
            }
        }

        if (!inTarget) {
            output.push(line);
        }
    }

    if (!replaced) {
        if (output.length && output[output.length - 1].trim() !== '') {
            output.push('');
        }
        output.push(...newLines);
    }

    return output.join('\n');
}

function normalizeLine(line) {
    return String(line || '').trim();
}

function stripBulletPrefix(line) {
    return line.replace(/^[-*+]\s*/, '').trim();
}

function parseDependenciesList(sectionText) {
    if (!sectionText || typeof sectionText !== 'string') {
        return [];
    }
    const lines = sectionText.split(/\r?\n/);
    const results = [];

    let inInjectedBlock = false;
    for (const line of lines) {
        const trimmed = normalizeLine(line);
        if (!trimmed) continue;
        if (/^###\s+Dependency Function Descriptions\s*$/i.test(trimmed)) {
            inInjectedBlock = true;
            continue;
        }
        if (/^#{1,6}\s+/.test(trimmed)) {
            inInjectedBlock = false;
            continue;
        }
        if (inInjectedBlock) {
            continue;
        }
        const content = stripBulletPrefix(trimmed);
        if (!content || !content.includes(':')) continue;
        const colonIndex = content.indexOf(':');
        if (colonIndex <= 0) continue;
        const leftPart = content.slice(0, colonIndex).trim();
        const reason = normalizeLine(content.slice(colonIndex + 1));
        if (!reason) continue;
        const sepIndex = leftPart.indexOf(' - ');
        if (sepIndex <= 0) continue;
        const depPath = normalizeLine(leftPart.slice(0, sepIndex));
        const functionName = normalizeLine(leftPart.slice(sepIndex + 3));
        if (!depPath || !functionName) continue;
        results.push({ path: depPath, functionName, reason });
    }

    return results;
}

function parseMainFunctionsList(sectionText) {
    if (!sectionText || typeof sectionText !== 'string') {
        return new Map();
    }
    const lines = sectionText.split(/\r?\n/);
    const results = new Map();

    let currentName = null;
    let currentLines = [];
    const flush = () => {
        if (!currentName || currentLines.length === 0) return;
        const fullLine = currentLines.join('\n').trim();
        results.set(currentName, fullLine);
        currentName = null;
        currentLines = [];
    };

    for (const line of lines) {
        const trimmed = normalizeLine(line);
        if (!trimmed) continue;
        if (/^#{1,6}\s+/.test(trimmed)) {
            flush();
            continue;
        }
        if (/^[-*+]\s+/.test(trimmed)) {
            flush();
            const content = stripBulletPrefix(trimmed);
            if (!content) continue;
            const namePart = content.split(/\s+/)[0];
            const functionName = normalizeLine(namePart);
            if (!functionName) continue;
            currentName = functionName;
            currentLines.push(content);
            continue;
        }
        if (currentName) {
            currentLines.push(trimmed);
        }
    }
    flush();

    return results;
}

function parseExportsList(sectionText) {
    if (!sectionText || typeof sectionText !== 'string') {
        return [];
    }
    const lines = sectionText.split(/\r?\n/);
    const results = [];

    for (const line of lines) {
        const trimmed = normalizeLine(line);
        if (!trimmed) continue;
        if (/^#{1,6}\s+/.test(trimmed)) continue;
        const content = stripBulletPrefix(trimmed);
        if (!content) continue;
        const namePart = content.includes(':')
            ? content.slice(0, content.indexOf(':')).trim()
            : content;
        if (!namePart) continue;
        results.push(namePart);
    }

    return results;
}

function parseDsExportsList(sectionText) {
    if (!sectionText || typeof sectionText !== 'string') {
        return [];
    }
    const lines = sectionText.split(/\r?\n/);
    const results = [];

    for (const line of lines) {
        const trimmed = normalizeLine(line);
        if (!trimmed) continue;
        if (/^#{1,6}\s+/.test(trimmed)) continue;
        const content = stripBulletPrefix(trimmed);
        if (!content) continue;
        const lower = content.toLowerCase();
        const exportsIndex = lower.indexOf('exports:');
        if (exportsIndex < 0) continue;

        const leftPart = content.slice(0, exportsIndex).trim();
        const pathPart = leftPart.split(/\s+-\s+/)[0].trim();
        if (!pathPart) continue;

        const exportsPart = content.slice(exportsIndex + 'exports:'.length).trim();
        if (!exportsPart) continue;

        const exportsEntries = exportsPart
            .split(';')
            .map(entry => entry.trim())
            .filter(Boolean)
            .map(entry => {
                if (!entry) return null;
                if (!entry.includes(':')) return entry.trim();
                return entry.slice(0, entry.indexOf(':')).trim();
            })
            .filter(Boolean);

        if (exportsEntries.length) {
            results.push({ path: pathPart, exports: exportsEntries });
        }
    }

    return results;
}

function buildDependencyDescriptionsBlock(entries, lineResolver, { placeholder = 'MISSING' } = {}) {
    if (!entries || entries.length === 0) {
        return '### Dependency Function Descriptions\n\nNo dependency functions declared.';
    }

    const lines = ['### Dependency Function Descriptions', ''];
    for (const entry of entries) {
        const resolved = lineResolver(entry);
        if (resolved && typeof resolved === 'string') {
            lines.push(`- ${entry.path} - ${entry.functionName} : ${resolved}`);
        } else {
            lines.push(`- ${entry.path} - ${entry.functionName} : ${placeholder}`);
        }
    }

    return lines.join('\n');
}

function stripDependencyDescriptionsBlock(sectionText) {
    if (!sectionText || typeof sectionText !== 'string') {
        return sectionText || '';
    }
    const lines = sectionText.split(/\r?\n/);
    const output = [];
    let skipping = false;

    for (const line of lines) {
        const trimmed = normalizeLine(line);
        if (/^###\s+Dependency Function Descriptions\s*$/i.test(trimmed)) {
            skipping = true;
            continue;
        }
        if (skipping && /^#{1,6}\s+/.test(trimmed)) {
            skipping = false;
        }
        if (!skipping) {
            output.push(line);
        }
    }

    return output.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function injectDependencyDescriptions(fdsContent, resolver, { placeholder = 'MISSING' } = {}) {
    if (!fdsContent || typeof fdsContent !== 'string') {
        return fdsContent;
    }
    const sections = parseSections(fdsContent);
    const dependenciesText = sections.get('Dependencies') || '';
    const entries = parseDependenciesList(dependenciesText);

    const lineResolver = (entry) => {
        if (!resolver || typeof resolver !== 'function') {
            return null;
        }
        const resolved = resolver(entry);
        if (!resolved || typeof resolved !== 'string') {
            return null;
        }
        return resolved.trim();
    };

    const block = buildDependencyDescriptionsBlock(entries, lineResolver, { placeholder });
    const cleaned = stripDependencyDescriptionsBlock(dependenciesText);

    const newDependencies = cleaned
        ? `${cleaned}\n\n${block}`
        : block;

    return updateSectionContent(fdsContent, 'Dependencies', newDependencies);
}

async function readFileContent(filePath) {
    return fs.readFile(filePath, 'utf-8');
}

async function writeFileContent(filePath, content) {
    await fs.writeFile(filePath, content, 'utf-8');
}

function buildGetSection(sectionName) {
    return async function getSection(filePath) {
        const content = await readFileContent(filePath);
        const sections = parseSections(content);
        return sections.get(sectionName) || '';
    };
}

function buildUpdateSection(sectionName) {
    return async function updateSection(filePath, newText) {
        const content = await readFileContent(filePath);
        const updated = updateSectionContent(content, sectionName, newText);
        await writeFileContent(filePath, updated);
        return updated;
    };
}

const getVisionAndProblemStatementSection = buildGetSection('Vision and Problem Statement');
const updateVisionAndProblemStatementSection = buildUpdateSection('Vision and Problem Statement');

const getIntendedUsersAndContextOfUseSection = buildGetSection('Intended Users and Context of Use');
const updateIntendedUsersAndContextOfUseSection = buildUpdateSection('Intended Users and Context of Use');

const getScopeAndBoundariesSection = buildGetSection('Scope and Boundaries');
const updateScopeAndBoundariesSection = buildUpdateSection('Scope and Boundaries');

const getSuccessCriteriaSection = buildGetSection('Success Criteria');
const updateSuccessCriteriaSection = buildUpdateSection('Success Criteria');

const getAffectedFilesSection = buildGetSection('Affected Files');
const updateAffectedFilesSection = buildUpdateSection('Affected Files');

const getDescriptionSection = buildGetSection('Description');
const updateDescriptionSection = buildUpdateSection('Description');

const getDependenciesSection = buildGetSection('Dependencies');
const updateDependenciesSection = buildUpdateSection('Dependencies');

const getMainFunctionsSection = buildGetSection('Main Functions');
const updateMainFunctionsSection = buildUpdateSection('Main Functions');

const getExportsSection = buildGetSection('Exports');
const updateExportsSection = buildUpdateSection('Exports');

const getImplementationDetailsSection = buildGetSection('Implementation Details');
const updateImplementationDetailsSection = buildUpdateSection('Implementation Details');

const getTestingSection = buildGetSection('Testing');
const updateTestingSection = buildUpdateSection('Testing');

export {
    DS_STRUCTURE,
    FDS_STRUCTURE,
    parseSections,
    updateSectionContent,
    parseDependenciesList,
    parseMainFunctionsList,
    parseExportsList,
    parseDsExportsList,
    buildDependencyDescriptionsBlock,
    stripDependencyDescriptionsBlock,
    injectDependencyDescriptions,
    getVisionAndProblemStatementSection,
    updateVisionAndProblemStatementSection,
    getIntendedUsersAndContextOfUseSection,
    updateIntendedUsersAndContextOfUseSection,
    getScopeAndBoundariesSection,
    updateScopeAndBoundariesSection,
    getSuccessCriteriaSection,
    updateSuccessCriteriaSection,
    getAffectedFilesSection,
    updateAffectedFilesSection,
    getDescriptionSection,
    updateDescriptionSection,
    getDependenciesSection,
    updateDependenciesSection,
    getMainFunctionsSection,
    updateMainFunctionsSection,
    getExportsSection,
    updateExportsSection,
    getImplementationDetailsSection,
    updateImplementationDetailsSection,
    getTestingSection,
    updateTestingSection,
};
