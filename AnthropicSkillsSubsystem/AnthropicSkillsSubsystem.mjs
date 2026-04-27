import fs from 'node:fs';
import path from 'node:path';

import { Sanitiser } from '../utils/Sanitiser.mjs';
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

    /**
     * Initialize a skill — async, heavy operations.
     *
     * No initialization needed for Anthropic skills.
     *
     * @param {Object} skillRecord - The skill record to initialize
     * @param {MainAgent} mainAgent - The main agent instance
     */
    async initSkill(skillRecord, mainAgent) {
        // No initialization needed for Anthropic skills.
    }

    async executeSkillPrompt({
        skillRecord,
        mainAgent,
        promptText,
        options = {},
    }) {
        this.llmAgent = mainAgent?.llmAgent || this.llmAgent;
        if (!this.llmAgent) {
            throw new Error('AnthropicSkillsSubsystem requires an llmAgent to execute skills.');
        }

        const internalSkills = mainAgent.getSkills()
            .filter((record) => Boolean(record?.isInternal && record?.preparedConfig?.modulePath));

        const tools = buildAnthropicTools({
            skillRecord,
            mainAgent,
            options,
            internalSkills,
        });

        const skillBody = skillRecord?.descriptor?.rawContent || skillRecord?.preparedConfig?.rawContent || '';
        const projectRoot = process.cwd();
        const systemPrompt = `${skillBody}\n\nProject root: ${projectRoot}`.trim();
        const sessionOptions = {
            model: options?.model || this.modelConfig.plan || 'plan',
            systemPrompt: systemPrompt || undefined,
        };
        const session = await this.llmAgent.startLoopAgentSession(tools, promptText, sessionOptions);
        const result = session.getLastResult();

        return {
            skill: skillRecord.name,
            preparedConfig: skillRecord.preparedConfig || null,
            result,
            session: 'loop',
        };
    }
}
