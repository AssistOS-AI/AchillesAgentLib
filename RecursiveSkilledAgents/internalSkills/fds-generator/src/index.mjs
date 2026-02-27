import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAffectedFilesSection } from './SpecsManager.mjs';
import { buildFdsPrompt } from './templates/fdsGeneration.prompts.mjs';

function normalizePath(value) {
    return String(value || '').replace(/\\/g, '/').trim();
}

function normalizeRelativePath(value) {
    const normalized = normalizePath(value);
    return normalized.replace(/^\.\//, '');
}

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

async function fileExists(filePath) {
    return fs.stat(filePath).then(stat => stat.isFile()).catch(() => false);
}

async function dirExists(dirPath) {
    return fs.stat(dirPath).then(stat => stat.isDirectory()).catch(() => false);
}

async function findDsFiles(searchRoot) {
    const files = [];
    const exists = await dirExists(searchRoot);
    if (!exists) {
        return files;
    }

    const walk = async (dir) => {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                await walk(fullPath);
                continue;
            }
            if (!entry.isFile()) {
                continue;
            }
            if (/^DS.*\.md$/i.test(entry.name)) {
                files.push(fullPath);
            }
        }
    };

    await walk(searchRoot);
    return files;
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

async function loadFdsTemplate() {
    const templatePath = path.join(
        path.dirname(fileURLToPath(import.meta.url)),
        'templates',
        'FDS_structure.md'
    );
    return fs.readFile(templatePath, 'utf-8');
}

async function generateFdsFile({
    llmAgent,
    template,
    dsContent,
    targetPath,
    existingFds,
}) {
    const prompt = buildFdsPrompt({
        template,
        dsContent,
        targetPath,
        existingFds,
    });

    const response = await llmAgent.executePrompt(prompt, {
        mode: 'code',
        responseShape: 'text',
        context: { intent: 'generate-fds-from-ds' },
    });

    if (typeof response !== 'string' || !response.trim()) {
        throw new Error(`LLM returned empty FDS for ${targetPath}`);
    }

    return response.trim();
}

/**
 * Orchestrator skill action entry point.
 * @param {Object} context - Execution context provided by OrchestratorSkillsSubsystem.
 * @param {string} context.prompt - The root directory to scan for DS files.
 * @param {Object} context.recursiveAgent - The recursive agent instance (provides llmAgent).
 * @param {Object} context.llmAgent - The LLM agent instance.
 * @param {object} [context.logger=console] - Logger instance.
 * @returns {Promise<Object>} Result object with message and generatedFiles array.
 */
export async function action(context) {
    const { prompt, recursiveAgent, llmAgent, logger = console } = context || {};
    const targetDir = typeof prompt === 'string' ? prompt.trim() : '';

    if (!targetDir) {
        throw new Error('fds-generator requires a target directory path as input.');
    }

    const agent = llmAgent || recursiveAgent?.llmAgent;
    if (!agent) {
        throw new Error('fds-generator requires an LLM agent.');
    }

    const dsFiles = await collectDsFiles(targetDir);
    if (!dsFiles.length) {
        return { message: `No DS files found in ${targetDir}`, skipped: true, generatedFiles: [], regenerated: false };
    }

    const specsDir = path.join(targetDir, 'specs');
    const specsExists = await dirExists(specsDir);
    const template = await loadFdsTemplate();

    const generatedFiles = [];
    let regenerated = false;

    for (const dsPath of dsFiles) {
        const dsContent = await fs.readFile(dsPath, 'utf-8');
        const affectedSection = await getAffectedFilesSection(dsPath);
        const affectedFiles = parseAffectedFiles(affectedSection);
        const dsStats = await fs.stat(dsPath);

        if (!affectedFiles.length) {
            logger.warn(`[fds-generator] No affected files listed in ${dsPath}`);
            continue;
        }

        for (const relPath of affectedFiles) {
            const normalizedRel = normalizeRelativePath(relPath);
            const fdsPath = path.join(targetDir, normalizedRel);
            const fdsExists = await fileExists(fdsPath);
            const shouldRegenerateAll = !specsExists;

            let shouldRegenerate = shouldRegenerateAll || !fdsExists;
            if (!shouldRegenerate && fdsExists) {
                const fdsStats = await fs.stat(fdsPath);
                if (dsStats.mtimeMs > fdsStats.mtimeMs) {
                    shouldRegenerate = true;
                }
            }

            if (!shouldRegenerate) {
                continue;
            }

            const existingFds = fdsExists ? await fs.readFile(fdsPath, 'utf-8') : '';
            const generated = await generateFdsFile({
                llmAgent: agent,
                template,
                dsContent,
                targetPath: normalizedRel,
                existingFds,
            });

            await fs.mkdir(path.dirname(fdsPath), { recursive: true });
            await fs.writeFile(fdsPath, generated, 'utf-8');
            generatedFiles.push(normalizedRel);
            regenerated = true;
        }
    }

    if (!generatedFiles.length) {
        return { message: `FDS up-to-date for ${targetDir}`, skipped: true, generatedFiles: [], regenerated: false };
    }

    return {
        message: `FDS generation completed for ${targetDir}`,
        generatedFiles,
        regenerated,
    };
}
