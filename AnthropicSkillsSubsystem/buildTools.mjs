import fs from 'node:fs';
import path from 'node:path';

import {
    isDirectory,
    isProbablyText,
    isSafeChildPath,
    runBashCommand,
} from '../utils/internalSkillsUtils.mjs';

function resolveInternalSkillRecord(internalSkills, shortName) {
    if (!shortName || !Array.isArray(internalSkills)) {
        return null;
    }
    for (const entry of internalSkills) {
        if (!entry) {
            continue;
        }
        if (typeof entry === 'string') {
            if (entry === shortName) {
                return { name: entry, shortName: entry };
            }
            continue;
        }
        const candidate = entry.shortName || entry.name;
        if (candidate === shortName) {
            return entry;
        }
    }
    return null;
}

function buildSkillHandler(skillRecord, mainAgent, forwardedContext) {
    return async (_agent, promptText) => {
        const executionResult = await mainAgent.executeSkill(skillRecord.name, promptText, {
            context: forwardedContext,
        });
        return executionResult?.result;
    };
}

export function buildAnthropicTools({
    skillRecord,
    mainAgent,
    options = {},
    internalSkills = [],
}) {
    const skillDir = skillRecord?.skillDir || null;
    const scriptsDir = skillDir ? path.join(skillDir, 'scripts') : null;
    const resourcesDir = skillDir ? path.join(skillDir, 'resources') : null;

    const tools = {};
    const forwardedContext = options?.context || {};

    // Build tools from internal skills (from skills/ directory)
    const internalSkillNames = ['read', 'write', 'edit', 'glob', 'grep', 'bash', 'webfetch'];
    
    for (const skillName of internalSkillNames) {
        const skill = resolveInternalSkillRecord(internalSkills, skillName);
        if (skill) {
            const description = skill.descriptor?.rawContent || `${skillName} skill`;
            tools[skillName] = {
                description,
                handler: buildSkillHandler(skill, mainAgent, forwardedContext),
            };
        }
    }

    if (scriptsDir && isDirectory(scriptsDir)) {
        tools['run-script'] = {
            description: 'Purpose: Execute a script from scripts/. When to use: run a packaged script for this skill. Keywords: run script, execute script, scripts/.',
            handler: async (_agent, promptText) => {
                const command = String(promptText ?? '').trim();
                if (!command) {
                    throw new Error('run-script requires a command string.');
                }
                const normalizedCommand = command.replace(/\\/g, '/');
                const adjustedCommand = normalizedCommand.replace(
                    /(\s|^)(scripts\/[^\s]+)/,
                    (match, prefix, scriptPath) => {
                        const fullPath = path.resolve(skillDir, scriptPath);
                        if (!isSafeChildPath(scriptsDir, fullPath)) {
                            throw new Error('run-script path must be inside scripts/.');
                        }
                        return `${prefix}${fullPath}`;
                    }
                );
                const output = await runBashCommand(adjustedCommand, skillDir || process.cwd());
                const stderrText = output.stderr ? `\n[stderr]\n${output.stderr}` : '';
                const exitCodeText = output.exitCode ? `\n[exitCode] ${output.exitCode}` : '';
                return `${output.stdout || ''}${stderrText}${exitCodeText}`.trim();
            },
        };
    }

    if (resourcesDir && isDirectory(resourcesDir)) {
        tools['get-resource'] = {
            description: 'Purpose: Read a file from resources/. When to use: fetch a bundled resource file for this skill. Keywords: get resource, read resource, resources/.',
            handler: async (_agent, promptText) => {
                const resourcePath = String(promptText ?? '').trim();
                if (!resourcePath) {
                    throw new Error('get-resource requires a relative path.');
                }

                const normalized = resourcePath.replace(/\\/g, '/');
                const relativePath = normalized.startsWith('resources/')
                    ? normalized.slice('resources/'.length)
                    : normalized;
                const resolvedResource = path.resolve(resourcesDir, relativePath);
                if (!isSafeChildPath(resourcesDir, resolvedResource)) {
                    throw new Error('get-resource path must be inside resources/.');
                }

                let stats;
                try {
                    stats = fs.statSync(resolvedResource);
                } catch (error) {
                    throw new Error(`get-resource cannot access ${resourcePath}: ${error.message}`);
                }

                if (!stats.isFile()) {
                    throw new Error('get-resource target must be a file.');
                }

                const buffer = await fs.promises.readFile(resolvedResource);
                if (isProbablyText(buffer)) {
                    return buffer.toString('utf8');
                }
                return buffer.toString('base64');
            },
        };
    }

    return tools;
}
