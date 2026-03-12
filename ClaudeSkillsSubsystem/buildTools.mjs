import fs from 'node:fs';
import path from 'node:path';

import { buildBashTool } from './tools/bash.mjs';
import { buildEditTool } from './tools/edit.mjs';
import { buildGlobTool } from './tools/glob.mjs';
import { buildGrepTool } from './tools/grep.mjs';
import { buildReadTool } from './tools/read.mjs';
import { buildWebFetchTool } from './tools/webfetch.mjs';
import { buildWriteTool } from './tools/write.mjs';
import {
    isDirectory,
    isProbablyText,
    isSafeChildPath,
    runBashCommand,
} from './tools/utils.mjs';

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

function buildSkillHandler(skillRecord, recursiveAgent, forwardedContext) {
    return async (_agent, promptText) => {
        const executionResult = await recursiveAgent.executePrompt(promptText, {
            skillName: skillRecord.name,
            context: forwardedContext,
            sessionMemory: forwardedContext.sessionMemory || null,
        });
        return executionResult?.result;
    };
}

export function buildClaudeTools({
    skillRecord,
    recursiveAgent,
    options = {},
    sessionMemory,
    internalSkills = [],
}) {
    const skillDir = skillRecord?.skillDir || null;
    const scriptsDir = skillDir ? path.join(skillDir, 'scripts') : null;
    const resourcesDir = skillDir ? path.join(skillDir, 'resources') : null;

    const tools = {};

    const forwardedContext = options?.context || {};
    const askUserSkill = resolveInternalSkillRecord(internalSkills, 'ask-user');
    const askUserDescription = askUserSkill?.descriptor?.rawContent;

    tools['ask-user'] = {
        description: `${askUserDescription || ''}
How to call: pass a plain string question as the tool input.
Examples:
- "What is your target audience?"
- "Which pricing tier should we focus on?"`.trim(),
        handler: buildSkillHandler(askUserSkill, recursiveAgent, {
            ...forwardedContext,
            sessionMemory,
        }),
    };

    tools.read = buildReadTool();
    tools.write = buildWriteTool();
    tools.edit = buildEditTool();
    tools.glob = buildGlobTool();
    tools.grep = buildGrepTool();
    tools.bash = buildBashTool();
    tools.webfetch = buildWebFetchTool();

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
