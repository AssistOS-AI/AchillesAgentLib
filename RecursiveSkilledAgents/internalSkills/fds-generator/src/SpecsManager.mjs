import fs from 'node:fs/promises';

const DS_SECTIONS = [
    'Vision and Problem Statement',
    'Intended Users and Context of Use',
    'Scope and Boundaries',
    'Success Criteria',
    'Pointers to Supporting DS Files',
    'Affected Files',
];

const FDS_SECTIONS = [
    'Description',
    'Dependencies',
    'Main Functions or Methods',
    'Exports',
    'Implementation Details',
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

const getPointersToSupportingDsFilesSection = buildGetSection('Pointers to Supporting DS Files');
const updatePointersToSupportingDsFilesSection = buildUpdateSection('Pointers to Supporting DS Files');

const getAffectedFilesSection = buildGetSection('Affected Files');
const updateAffectedFilesSection = buildUpdateSection('Affected Files');

const getDescriptionSection = buildGetSection('Description');
const updateDescriptionSection = buildUpdateSection('Description');

const getDependenciesSection = buildGetSection('Dependencies');
const updateDependenciesSection = buildUpdateSection('Dependencies');

const getMainFunctionsOrMethodsSection = buildGetSection('Main Functions or Methods');
const updateMainFunctionsOrMethodsSection = buildUpdateSection('Main Functions or Methods');

const getExportsSection = buildGetSection('Exports');
const updateExportsSection = buildUpdateSection('Exports');

const getImplementationDetailsSection = buildGetSection('Implementation Details');
const updateImplementationDetailsSection = buildUpdateSection('Implementation Details');

export {
    DS_STRUCTURE,
    FDS_STRUCTURE,
    parseSections,
    updateSectionContent,
    getVisionAndProblemStatementSection,
    updateVisionAndProblemStatementSection,
    getIntendedUsersAndContextOfUseSection,
    updateIntendedUsersAndContextOfUseSection,
    getScopeAndBoundariesSection,
    updateScopeAndBoundariesSection,
    getSuccessCriteriaSection,
    updateSuccessCriteriaSection,
    getPointersToSupportingDsFilesSection,
    updatePointersToSupportingDsFilesSection,
    getAffectedFilesSection,
    updateAffectedFilesSection,
    getDescriptionSection,
    updateDescriptionSection,
    getDependenciesSection,
    updateDependenciesSection,
    getMainFunctionsOrMethodsSection,
    updateMainFunctionsOrMethodsSection,
    getExportsSection,
    updateExportsSection,
    getImplementationDetailsSection,
    updateImplementationDetailsSection,
};
