import path from 'node:path';

import { LLMAgent } from '../LLMAgents/LLMAgent.mjs';
import { createLogger } from '../utils/DebugLogger.mjs';
import { Sanitiser } from '../utils/Sanitiser.mjs';

import { DEFAULT_SESSION_ID } from './constants.mjs';
import { discoverSkills, discoverSkillsFromRoot } from './services/discoverSkills.mjs';
import { SubsystemFactory } from './services/SubsystemFactory.mjs';
import { SecuritySupervisor } from './supervisor/SecuritySupervisor.mjs';

const INTERNAL_SKILLS_DIR = path.resolve(
    new URL('.', import.meta.url).pathname,
    '../skills'
);

export class MainAgent {
    constructor({
        startDir = process.cwd(),
        supervisor = null,
        logger = null,
        llmAgentOptions = {},
        modelConfig = null,
    } = {}) {
        this.startDir = startDir;
        this.logger = logger || createLogger();

        this.llmAgent = new LLMAgent({ ...llmAgentOptions, modelConfig });

        this._skills = new Map();
        this._skillAliases = new Map();
        this._sessions = new Map();

        this.supervisor = supervisor || new SecuritySupervisor({ logger: this.logger });

        this.subsystemFactory = new SubsystemFactory({
            llmAgent: this.llmAgent,
            modelConfig: this.llmAgent.modelConfig,
        });

        this._discoverAndRegister();
    }

    _discoverAndRegister() {
        const internalSkills = discoverSkillsFromRoot(INTERNAL_SKILLS_DIR, {
            logger: this.logger,
        });

        for (const record of internalSkills) {
            record.isInternal = true;
            this._registerSkill(record);
        }

        this.logger.debug('MainAgent:internalSkills', {
            count: internalSkills.length,
            skills: internalSkills.map(s => s.name),
        });

        const userSkills = discoverSkills(this.startDir, {
            logger: this.logger,
        });

        for (const record of userSkills) {
            record.isInternal = false;
            this._registerSkill(record);
        }

        this.logger.debug('MainAgent:userSkills', {
            count: userSkills.length,
            skills: userSkills.map(s => s.name),
        });
    }

    _registerSkill(skillRecord) {
        const { name, type, shortName, descriptor, skillDir } = skillRecord;

        const baseName = sanitiseName(descriptor?.name || shortName);
        const aliases = new Set([
            name,
            sanitiseName(name),
            shortName,
            sanitiseName(shortName),
            baseName,
        ].filter(Boolean));

        if (this._skills.has(name)) {
            this.logger.debug('MainAgent:duplicateSkill', {
                name,
                existingDir: this._skills.get(name).skillDir,
                newDir: skillDir,
            });
        }

        this._skills.set(name, skillRecord);

        for (const alias of aliases) {
            this._skillAliases.set(alias, skillRecord);
        }

        const subsystem = this.subsystemFactory.get(type);
        if (subsystem && typeof subsystem.parseSkillDescriptor === 'function') {
            try {
                skillRecord.descriptor = subsystem.parseSkillDescriptor({
                    filePath: skillRecord.filePath,
                    skillDir: skillRecord.skillDir,
                    shortName: skillRecord.shortName,
                });
            } catch (error) {
                this.logger.warn(`[MainAgent] Failed to parse skill ${skillRecord.shortName}: ${error.message}`);
            }
        }

        if (!skillRecord.descriptor) {
            skillRecord.descriptor = {
                name: skillRecord.shortName,
                rawContent: '',
                sections: {},
            };
        }

        if (subsystem && typeof subsystem.prepareSkill === 'function') {
            try {
                subsystem.prepareSkill(skillRecord, this);
            } catch (error) {
                this.logger.warn(`[MainAgent] Failed to prepare skill ${skillRecord.name}: ${error.message}`);
            }
        }
    }

    async executePrompt(message, options = {}) {
        const {
            sessionId = null,
            model = null,
            tags = null,
            systemPrompt = null,
        } = options;

        const resolvedSessionId = sessionId || DEFAULT_SESSION_ID;
        let session = this._sessions.get(resolvedSessionId);

        if (!session) {
            const tools = this._buildToolsForSession();
            session = await this.llmAgent.startLoopAgentSession(tools, message, {
                model,
                tags,
                systemPrompt,
                supervisor: this.supervisor,
            });
            this._sessions.set(resolvedSessionId, session);
        } else {
            await session.newPrompt(message);
        }

        return {
            result: session.getLastResult(),
            sessionId: resolvedSessionId,
            status: session.status,
        };
    }

    async executeSkill(skillName, prompt, options = {}) {
        const skillRecord = this.getSkillRecord(skillName);
        if (!skillRecord) {
            throw new Error(`Skill "${skillName}" not found.`);
        }

        const subsystem = this.subsystemFactory.get(skillRecord.type);
        if (!subsystem || typeof subsystem.executeSkillPrompt !== 'function') {
            throw new Error(`Subsystem for type "${skillRecord.type}" does not support execution.`);
        }

        return subsystem.executeSkillPrompt({
            skillRecord,
            mainAgent: this,
            promptText: prompt,
            options,
        });
    }

    /**
     * Initialize all skills — async, heavy one-time setup.
     *
     * Unlike `prepareSkill` (called automatically during registration for fast,
     * synchronous config parsing), `initSkills` performs expensive operations
     * like code generation from specs/ for code skills.
     *
     * Must be called explicitly before executing skills that require initialization.
     * Safe to call multiple times — skills that are already initialized are skipped.
     */
    async initSkills() {
        const skills = this.getSkills();
        for (const skillRecord of skills) {
            const subsystem = this.subsystemFactory.get(skillRecord.type);
            if (subsystem && typeof subsystem.initSkill === 'function') {
                try {
                    await subsystem.initSkill(skillRecord, this);
                } catch (error) {
                    this.logger.warn(`[MainAgent] Failed to initialize skill ${skillRecord.name}: ${error.message}`);
                }
            }
        }
    }

    _buildToolsForSession() {
        const tools = {};
        const allSkills = this.getSkills();

        for (const skillRecord of allSkills) {
            const toolName = sanitiseName(skillRecord.shortName || skillRecord.name);
            tools[toolName] = {
                handler: async (agent, promptText) => {
                    const safePrompt = typeof promptText === 'string'
                        ? promptText
                        : (promptText != null ? JSON.stringify(promptText) : '');

                    const result = await this.executeSkill(skillRecord.name, safePrompt, {
                        model: 'plan',
                    });
                    const output = result?.result;
                    if (output == null) return '';
                    if (typeof output === 'string') return output;
                    try { return JSON.stringify(output); } catch { return String(output); }
                },
                description: skillRecord.descriptor?.rawContent || skillRecord.descriptor?.name || skillRecord.name,
            };
        }

        return tools;
    }
    

    getSkillRecord(identifier) {
        if (!identifier || typeof identifier !== 'string') {
            return null;
        }
        const normalized = sanitiseName(identifier);
        return this._skillAliases.get(normalized) || null;
    }

    listSkillsByType(type) {
        return Array.from(this._skills.values()).filter(record => record.type === type);
    }

    getSkills() {
        return Array.from(this._skills.values());
    }

    ensureSubsystem(type) {
        return this.subsystemFactory.get(type);
    }

    deleteSession(sessionId) {
        return this._sessions.delete(sessionId);
    }

    hasSession(sessionId) {
        return this._sessions.has(sessionId);
    }

    getActiveSessions() {
        return Array.from(this._sessions.keys()).filter(key => key !== DEFAULT_SESSION_ID);
    }

    clearSessions() {
        this._sessions.clear();
    }

    shutdown() {
        this._sessions.clear();
    }
}

function sanitiseName(value) {
    return Sanitiser.sanitiseName(value);
}
