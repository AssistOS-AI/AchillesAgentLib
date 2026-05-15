import path from 'node:path';

import { LLMAgent } from '../LLMAgents/LLMAgent.mjs';
import { createLogger } from '../utils/DebugLogger.mjs';
import { Sanitiser } from '../utils/Sanitiser.mjs';

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
        disableInternalSkills = true,
    } = {}) {
        this.startDir = startDir;
        this.logger = logger || createLogger();
        this.disableInternalSkills = Boolean(disableInternalSkills);

        this.llmAgent = new LLMAgent({ ...llmAgentOptions, modelConfig });

        this._skills = new Map();
        this._skillAliases = new Map();
        this._orchestratorAllowedSkills = new Set();
        this._session = null;

        this.supervisor = supervisor || new SecuritySupervisor({ logger: this.logger });

        this.subsystemFactory = new SubsystemFactory({
            mainAgent: this,
            modelConfig: this.llmAgent.modelConfig,
        });

        this._discoverAndRegister();
    }

    _discoverAndRegister() {
        const internalSkills = this.disableInternalSkills
            ? []
            : discoverSkillsFromRoot(INTERNAL_SKILLS_DIR, {
                logger: this.logger,
            });

        for (const record of internalSkills) {
            record.isInternal = true;
            this._registerSkill(record);
        }

        this.logger.debug('MainAgent:internalSkills', {
            count: internalSkills.length,
            skills: internalSkills.map(s => s.name),
            disabled: this.disableInternalSkills,
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

        this._refreshOrchestratedSkillIndex();
    }

    _refreshOrchestratedSkillIndex() {
        const orchestratorAllowedSkills = new Set();

        for (const skillRecord of this._skills.values()) {
            if (skillRecord.type !== 'orchestrator') {
                continue;
            }

            const declaredSkillNames = [
                ...(skillRecord.preparedConfig?.allowedSkills || []),
                ...(skillRecord.preparedConfig?.allowedPrepSkills || []),
            ];

            for (const declaredName of declaredSkillNames) {
                const targetRecord = this.getSkillRecord(declaredName);
                if (!targetRecord || targetRecord.name === skillRecord.name) {
                    continue;
                }
                orchestratorAllowedSkills.add(targetRecord.name);
            }
        }

        this._orchestratorAllowedSkills = orchestratorAllowedSkills;

        this.logger.debug('MainAgent:orchestratedSkills', {
            count: orchestratorAllowedSkills.size,
            skills: Array.from(orchestratorAllowedSkills),
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
            model = null,
            tags = null,
            systemPrompt = null,
            signal = null,
            supervisor = this.supervisor,
        } = options;

        if (!this._session) {
            const tools = this._buildToolsForSession();
            this._session = await this.llmAgent.startLoopAgentSession(tools, message, {
                model,
                tags,
                systemPrompt,
                supervisor,
                signal,
            });
        } else {
            await this._session.newPrompt(message, { signal });
        }

        return {
            result: this._session.getLastResult(),
            status: this._session.status,
        };
    }

    cancelCurrentSession(reason = 'cancelled') {
        if (this._session && typeof this._session.cancel === 'function') {
            this._session.cancel(reason);
        }
        if (this.llmAgent && typeof this.llmAgent.cancel === 'function') {
            this.llmAgent.cancel();
        }
    }

    async executeSkill(skillName, prompt, options = {}) {
        if (options?.signal?.aborted) {
            const error = new Error('Skill execution cancelled before start.');
            error.name = 'AbortError';
            throw error;
        }

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
            promptText: prompt,
            options,
        });
    }

    /**
     * Build all skills — async, heavy one-time setup.
     *
     * Unlike `prepareSkill` (called automatically during registration for fast,
     * synchronous config parsing), `buildSkills` performs expensive operations
     * like code generation from specs/ for code skills.
     *
     * Must be called explicitly before executing skills that require build-time preparation.
     * Safe to call multiple times — skills that are already built are skipped.
     */
    async buildSkills() {
        const skills = this.getSkills();
        const buildTasks = skills.map(async (skillRecord) => {
            const subsystem = this.subsystemFactory.get(skillRecord.type);
            if (subsystem && typeof subsystem.buildSkill === 'function') {
                try {
                    await subsystem.buildSkill(skillRecord, this);
                } catch (error) {
                    this.logger.warn(`[MainAgent] Failed to build skill ${skillRecord.name}: ${error.message}`);
                }
            }
        });

        await Promise.all(buildTasks);
    }

    _buildToolsForSession() {
        const tools = {};
        const allSkills = this.getSkills()
            .filter((skillRecord) => !this._orchestratorAllowedSkills.has(skillRecord.name));

        for (const skillRecord of allSkills) {
            const toolName = sanitiseName(skillRecord.shortName || skillRecord.name);
            tools[toolName] = {
                handler: async (agent, promptText, executionOptions = {}) => {
                    const safePrompt = typeof promptText === 'string'
                        ? promptText
                        : (promptText != null ? JSON.stringify(promptText) : '');
                    const parentSession = executionOptions?.session || null;
                    const parentSessionContext = parentSession && typeof parentSession.getConversationSnapshot === 'function'
                        ? parentSession.getConversationSnapshot()
                        : null;
                    const supervisor = parentSession?.supervisor || this.supervisor;
                    const context = parentSessionContext
                        ? { parentSession: parentSessionContext }
                        : {};

                    const result = await this.executeSkill(skillRecord.name, safePrompt, {
                        model: 'plan',
                        signal: executionOptions?.signal || null,
                        supervisor,
                        context,
                    });
                    const output = result?.result;
                    if (output == null) return '';
                    if (typeof output === 'string') return output;
                    try { return JSON.stringify(output); } catch { return String(output); }
                },
                description: skillRecord.type === 'orchestrator'
                    ? (skillRecord.descriptor?.sections?.description || skillRecord.descriptor?.name || skillRecord.name)
                    : (skillRecord.descriptor?.rawContent || skillRecord.descriptor?.name || skillRecord.name),
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

    shutdown() {
        this._session = null;
    }
}

function sanitiseName(value) {
    return Sanitiser.sanitiseName(value);
}
