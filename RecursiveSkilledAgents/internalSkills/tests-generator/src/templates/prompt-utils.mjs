function buildSourceFilesListing(sourceFiles) {
    if (!sourceFiles || sourceFiles.size === 0) {
        return 'No source files were provided.';
    }
    const sections = [];
    for (const [filePath, content] of sourceFiles.entries()) {
        sections.push(`${filePath}:\n${content}`);
    }
    return sections.join('\n\n');
}

function buildFdsSectionsListing(fdsEntries) {
    if (!Array.isArray(fdsEntries) || fdsEntries.length === 0) {
        return 'No FDS files were provided.';
    }
    const blocks = [];
    for (const entry of fdsEntries) {
        if (!entry || !entry.path) continue;
        const sections = entry.sections || {};
        const dependencies = sections.Dependencies || 'No content provided.';
        const mainFunctions = sections['Main Functions'] || 'No content provided.';
        const exportsText = sections.Exports || 'No content provided.';
        const testing = sections.Testing || 'No content provided.';
        blocks.push([
            `${entry.path}:`,
            'Dependencies:',
            dependencies,
            'Main Functions:',
            mainFunctions,
            'Exports:',
            exportsText,
            'Testing:',
            testing,
            '-------------------------------------------',
        ].join('\n'));
    }
    return blocks.join('\n\n');
}

export { buildSourceFilesListing, buildFdsSectionsListing };
