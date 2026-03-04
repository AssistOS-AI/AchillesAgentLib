import fs from 'node:fs/promises';
import path from 'node:path';
import {
    getAffectedFilesSection,
    injectDependencyDescriptions,
    parseDependenciesList,
    parseMainFunctionsList,
    parseSections,
} from '../../fds-generator/src/SpecsManager.mjs';
import {
    dirExists,
    fileExists,
    normalizeKeyPath,
    normalizeRelativePath,
} from './path-utils.mjs';

function parseAffectedFiles(sectionText) {
    if (!sectionText || typeof sectionText !== 'string') {
        return [];
    }
    const lines = sectionText.split(/\r?\n/);
    const results = [];

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const bulletMatch = trimmed.match(/^[-*+]\s*(.+)$/);
        const content = bulletMatch ? bulletMatch[1].trim() : trimmed;

        let pathPart = content;
        if (content.includes(' - ')) {
            pathPart = content.split(' - ')[0].trim();
        } else if (content.includes(':')) {
            pathPart = content.split(':')[0].trim();
        }

        const rel = normalizeRelativePath(pathPart);
        if (!rel || !rel.toLowerCase().endsWith('.md')) continue;
        results.push(rel);
    }

    return [...new Set(results)];
}

async function findDsFiles(searchRoot) {
    const files = [];
    const exists = await dirExists(searchRoot);
    if (!exists) {
        return files;
    }

    const entries = await fs.readdir(searchRoot, { withFileTypes: true });
    for (const entry of entries) {
        if (!entry.isFile()) {
            continue;
        }
        if (/^DS.*\.md$/i.test(entry.name)) {
            files.push(path.join(searchRoot, entry.name));
        }
    }

    return files;
}

function buildFdsCandidatePaths(depPath, sourcePath) {
    const normalized = normalizeRelativePath(depPath);
    if (!normalized) return [];

    const candidates = new Set();
    const addCandidate = (candidate) => {
        if (candidate) {
            candidates.add(candidate);
        }
    };

    if (normalized.startsWith('specs/')) {
        addCandidate(path.join(sourcePath, normalized));
        return [...candidates];
    }

    let rel = normalized.replace(/^\.\//, '');
    if (rel.endsWith('.md') || rel.endsWith('.mds')) {
        addCandidate(path.join(sourcePath, rel));
        addCandidate(path.join(sourcePath, 'specs', rel.replace(/^specs\//, '')));
        return [...candidates];
    }

    if (rel.startsWith('src/')) {
        rel = rel.slice(4);
    }

    addCandidate(path.join(sourcePath, 'specs', `${rel}.md`));
    addCandidate(path.join(sourcePath, 'specs', `${rel}.mds`));

    return [...candidates];
}

async function loadFdsMainFunctionsMap(depPath, sourcePath, cache) {
    const candidates = buildFdsCandidatePaths(depPath, sourcePath);
    let fdsPath = null;
    for (const candidate of candidates) {
        const exists = await fileExists(candidate);
        if (exists) {
            fdsPath = candidate;
            break;
        }
    }
    if (!fdsPath) {
        return null;
    }

    if (cache.has(fdsPath)) {
        return cache.get(fdsPath);
    }

    const fdsContent = await fs.readFile(fdsPath, 'utf-8');
    const sections = parseSections(fdsContent);
    const mainFunctionsText = sections.get('Main Functions') || '';
    const mainFunctionsMap = parseMainFunctionsList(mainFunctionsText);
    cache.set(fdsPath, mainFunctionsMap);
    return mainFunctionsMap;
}

async function enrichFdsDependencies(specContent, sourcePath) {
    if (!specContent || typeof specContent !== 'string') {
        return specContent;
    }
    const sections = parseSections(specContent);
    if (!sections.has('Dependencies') || !sections.has('Main Functions')) {
        return specContent;
    }

    const dependenciesText = sections.get('Dependencies') || '';
    const dependencies = parseDependenciesList(dependenciesText);
    if (!dependencies.length) {
        return injectDependencyDescriptions(specContent, () => null, { placeholder: 'MISSING' });
    }

    const cache = new Map();
    const resolvedMap = new Map();
    for (const entry of dependencies) {
        const normalizedPath = normalizeKeyPath(entry.path);
        const key = `${normalizedPath}::${entry.functionName}`;
        const mainFunctionsMap = await loadFdsMainFunctionsMap(entry.path, sourcePath, cache);
        if (!mainFunctionsMap) {
            continue;
        }
        const resolvedLine = mainFunctionsMap.get(entry.functionName);
        if (resolvedLine) {
            resolvedMap.set(key, resolvedLine);
        }
    }

    const resolver = (entry) => {
        const normalizedPath = normalizeKeyPath(entry.path);
        const key = `${normalizedPath}::${entry.functionName}`;
        return resolvedMap.get(key) || null;
    };

    return injectDependencyDescriptions(specContent, resolver, { placeholder: 'MISSING' });
}

async function collectDsFiles(targetDir) {
    const roots = [
        targetDir,
        path.join(targetDir, 'docs'),
        path.join(targetDir, 'docs', 'specs'),
    ];

    const seen = new Set();
    const results = [];

    for (const root of roots) {
        const matches = await findDsFiles(root);
        for (const match of matches) {
            if (seen.has(match)) continue;
            seen.add(match);
            results.push(match);
        }
    }

    return results;
}

async function shouldRunFdsGenerator(targetDir, logger) {
    const dsFiles = await collectDsFiles(targetDir);
    if (!dsFiles.length) {
        return false;
    }

    const specsDir = path.join(targetDir, 'specs');
    const specsExists = await dirExists(specsDir);
    if (!specsExists) {
        return true;
    }

    for (const dsPath of dsFiles) {
        const affectedSection = await getAffectedFilesSection(dsPath);
        const affectedFiles = parseAffectedFiles(affectedSection);
        const dsStats = await fs.stat(dsPath);

        if (!affectedFiles.length) {
            logger?.warn?.(`[generateMirrorCode] No affected files listed in ${dsPath}`);
            continue;
        }

        for (const relPath of affectedFiles) {
            const normalizedRel = normalizeRelativePath(relPath);
            const fdsPath = path.join(targetDir, normalizedRel);
            const fdsExists = await fileExists(fdsPath);
            if (!fdsExists) {
                return true;
            }
            const fdsStats = await fs.stat(fdsPath);
            if (dsStats.mtimeMs > fdsStats.mtimeMs) {
                return true;
            }
        }
    }

    return false;
}

export {
    collectDsFiles,
    enrichFdsDependencies,
    parseAffectedFiles,
    shouldRunFdsGenerator,
};
