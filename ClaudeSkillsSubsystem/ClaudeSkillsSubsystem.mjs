import fs from 'node:fs';
import path from 'node:path';

import { Sanitiser } from '../utils/Sanitiser.mjs';
import { SESSION_STATUS_AWAITING_INPUT, SESSION_KEY_PREFIX } from '../LLMAgents/constants.mjs';
import { buildClaudeTools } from './tools.mjs';

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

function isDirectory(target) {
    if (!target || !fs.existsSync(target)) {
        return false;
    }
    try {
        return fs.statSync(target).isDirectory();
    } catch (error) {
        return false;
    }
}


export class ClaudeSkillsSubsystem {
    constructor({ llmAgent = null } = {}) {
        this.type = 'claude';
        this.llmAgent = llmAgent;
    }

    prepareSkill(skillRecord) {
        const { descriptor, skillDir } = skillRecord;
        const scriptsDir = skillDir ? path.join(skillDir, 'scripts') : null;
        const resourcesDir = skillDir ? path.join(skillDir, 'resources') : null;

        const scripts = listFiles(scriptsDir, skillDir);
        const resources = listFiles(resourcesDir, skillDir);

        skillRecord.metadata = {
            type: this.type,
            title: descriptor?.title || null,
            summary: descriptor?.summary || null,
            body: descriptor?.body || null,
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
            throw new Error('ClaudeSkillsSubsystem requires an llmAgent to execute skills.');
        }

        const tools = buildClaudeTools({
            skillRecord,
            recursiveAgent,
            options,
            sessionMemory,
        });

        if (session && session.status === SESSION_STATUS_AWAITING_INPUT) {
            result = await session.newPrompt(promptText);
        } else {
            const sessionOptions = {
                mode: options?.mode || 'plan',
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
            metadata: skillRecord.metadata || null,
            result,
            session: 'loop',
            sessionMemory,
        };
    }
}
