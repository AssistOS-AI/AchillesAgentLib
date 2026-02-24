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

export { buildSourceFilesListing };
