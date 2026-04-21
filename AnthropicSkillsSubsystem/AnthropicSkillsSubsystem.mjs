import fs from 'node:fs';
import path from 'node:path';

import { Sanitiser } from '../utils/Sanitiser.mjs';
import { SESSION_STATUS_AWAITING_INPUT, SESSION_KEY_PREFIX } from '../LLMAgents/constants.mjs';
import { buildAnthropicTools } from './buildTools.mjs';
import { parseAnthropicSkillDocument } from './parseDescriptor.mjs';

function listFiles(rootDir, baseDir) {
    if (!rootDir || !fs.existsSync(rootDir)) {
        return [];
    }

    let entries = [];
    try {
        entries = fs.readdirSync(rootDir, { withFileTypes: true });
    } catch (error) {
        return [];
    }

    const files = [];
    for (const entry of entries) {
        const entryPath = path.join(rootDir, entry.name);
        if (entry.isDirectory()) {
            files.push(...listFiles(entryPath, baseDir));
            continue;
        }
        if (!entry.isFile()) {
            continue;
        }
        const relativePath = path.relative(baseDir, entryPath).split(path.sep).join('/');
        files.push(relativePath);
    }

    return files;
}


export class AnthropicSkillsSubsystem {
    constructor({ llmAgent = null, modelConfig = null } = {}) {
        this.type = 'anthropic';
        this.llmAgent = llmAgent;
        this.modelConfig = modelConfig || { plan: 'plan', code: 'code' };
    }

    parseSkillDescriptor({ filePath }) {
        return parseAnthropicSkillDocument(filePath);
    }

    prepareSkill(skillRecord) {
        const { descriptor, skillDir } = skillRecord;
        const scriptsDir = skillDir ? path.join(skillDir, 'scripts') : null;
        const resourcesDir = skillDir ? path.join(skillDir, 'resources') : null;

        const scripts = listFiles(scriptsDir, skillDir);
        const resources = listFiles(resourcesDir, skillDir);

        skillRecord.preparedConfig = {
            type: this.type,
            name: descriptor?.name || null,
            rawContent: descriptor?.rawContent || null,
            sections: descriptor?.sections || {},
            scripts,
            resources,
        };
    }

    async executeSkillPrompt({
        skillRecord,
        recursiveAgent,
        promptText,
        options = {},
    }) {
        const sessionMemory = options?.context?.sessionMemory || options?.sessionMemory || null;
        const sessionKey = `${SESSION_KEY_PREFIX}${Sanitiser.sanitiseName(skillRecord.name)}`;
        let session = sessionMemory?.get?.(sessionKey) || null;
        let result;

        this.llmAgent = recursiveAgent?.llmAgent || this.llmAgent;
        if (!this.llmAgent) {
            throw new Error('AnthropicSkillsSubsystem requires an llmAgent to execute skills.');
        }

        const internalSkills = recursiveAgent?.registry?.getAll?.()
            ?.filter((record) => Boolean(record?.preparedConfig?.modulePath))
            || [];

        const tools = buildAnthropicTools({
            skillRecord,
            recursiveAgent,
            options,
            sessionMemory,
            internalSkills,
        });

        if (session && session.status === SESSION_STATUS_AWAITING_INPUT) {
            result = await session.newPrompt(promptText);
        } else {
            const skillBody = skillRecord?.descriptor?.rawContent || skillRecord?.preparedConfig?.rawContent || '';
            const projectRoot = process.cwd();
            const systemPrompt = `${skillBody}\n\nProject root: ${projectRoot}`.trim();
            const sessionOptions = {
                model: options?.model || this.modelConfig.plan || 'plan',
                systemPrompt: systemPrompt || undefined,
            };
            session = await this.llmAgent.startLoopAgentSession(tools, promptText, sessionOptions);
            result = session.getLastResult();
        }

        if (session.status === SESSION_STATUS_AWAITING_INPUT && sessionMemory?.set) {
            sessionMemory.set(sessionKey, session);
        } else if (sessionMemory?.delete) {
            sessionMemory.delete(sessionKey);
        }

        return {
            skill: skillRecord.name,
            preparedConfig: skillRecord.preparedConfig || null,
            result,
            session: 'loop',
            sessionMemory,
        };
    }
}
