import fs from 'node:fs';
import path from 'node:path';
import { detectImplementation } from './cliUtils.mjs';

export const resolveSkillRoot = (dir) => {
    const absolute = path.resolve(dir);
    if (fs.existsSync(absolute)) {
        const stats = fs.statSync(absolute);
        if (stats.isDirectory() && path.basename(absolute) === '.AchillesSkills') {
            return absolute;
        }
    }
    const candidate = path.join(absolute, '.AchillesSkills');
    if (!fs.existsSync(candidate)) {
        return null;
    }
    const stats = fs.statSync(candidate);
    return stats.isDirectory() ? candidate : null;
};

export const registerLocalSkills = (cli) => {
    const skillRoots = cli.skillSearchRoots
        .map((dir) => resolveSkillRoot(dir))
        .filter(Boolean);

    cli.recursiveAgent.skillCatalog.clear();
    cli.recursiveAgent.skillAliases.clear();
    cli.recursiveAgent.skillToSubsystem.clear();

    const seenSubsystems = new Set();
    for (const [key] of cli.recursiveAgent.subsystems) {
        seenSubsystems.add(key);
    }
    cli.recursiveAgent.subsystems.clear();
    seenSubsystems.forEach((key) => cli.recursiveAgent.ensureSubsystem(key));

    skillRoots.forEach((root) => {
        try {
            cli.recursiveAgent.registerSkillsFromRoot(root);
        } catch (error) {
            cli.output.write(`${cli.colors.warn}[warn] Failed to register skills from ${root}: ${error.message}${cli.colors.reset}\n`);
        }
    });
};

export const getSkillCatalog = (cli) => Array.from(cli.recursiveAgent.skillCatalog.values());

export const listSkills = async (cli, columns, timeoutMs = 1500) => {
    const compute = () => {
        const rows = getSkillCatalog(cli)
            .map((record) => ({
                name: record.name,
                type: record.type,
                summary: record.descriptor?.summary || '',
                implementation: detectImplementation(record),
            }))
            .sort((a, b) => {
                if (a.type === b.type) {
                    return a.name.localeCompare(b.name);
                }
                return a.type.localeCompare(b.type);
            });

        const selectedColumns = (columns && columns.length) ? columns : ['name', 'type', 'summary', 'implementation'];
        return rows.map((row) => selectedColumns
            .map((column) => row[column] || '')
            .join(' | '));
    };

    let timeoutHandle;
    const timeoutPromise = new Promise((_, reject) => {
        timeoutHandle = setTimeout(() => {
            reject(new Error('Skill listing timed out.'));
        }, timeoutMs);
        if (typeof timeoutHandle.unref === 'function') {
            timeoutHandle.unref();
        }
    });

    try {
        return await Promise.race([
            Promise.resolve().then(compute),
            timeoutPromise,
        ]);
    } finally {
        if (timeoutHandle) {
            clearTimeout(timeoutHandle);
        }
    }
};

export const findSkill = (cli, name) => {
    if (!name) {
        return null;
    }
    const normalized = name.trim().toLowerCase();
    return getSkillCatalog(cli).find((record) => {
        const names = [
            record.name,
            record.shortName,
            record.descriptor?.title,
        ].filter(Boolean).map((entry) => entry.toLowerCase());
        return names.includes(normalized);
    }) || null;
};

export const getOrchestrators = (cli) => getSkillCatalog(cli).filter((record) => record.type === 'orchestrator');

export default {
    resolveSkillRoot,
    registerLocalSkills,
    getSkillCatalog,
    listSkills,
    findSkill,
    getOrchestrators,
};
